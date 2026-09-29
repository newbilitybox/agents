/**
 * All knowledge about the claude CLI lives here: how to find it, how to talk
 * to it, what its output/JSON looks like. Version-sensitive details are
 * isolated in this module.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  writeFileSync,
  statSync,
  readSync,
  openSync,
  closeSync,
  appendFileSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  lstatSync,
  symlinkSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AccountUsage } from '../shared/types'

const execFileP = promisify(execFile)
const SHELL = process.env['SHELL'] || '/bin/zsh'

let cachedEnv: Record<string, string> | null = null
let cachedClaudePath: string | null = null

/**
 * GUI apps launched from Finder don't inherit the shell PATH — capture the
 * login-shell environment once and reuse it for every claude invocation.
 */
export async function loginShellEnv(): Promise<Record<string, string>> {
  if (cachedEnv) return cachedEnv
  const { stdout } = await execFileP(SHELL, ['-lic', 'env'], { maxBuffer: 1024 * 1024 })
  const env: Record<string, string> = {}
  let lastKey: string | null = null
  for (const line of stdout.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m) {
      env[m[1]] = m[2]
      lastKey = m[1]
    } else if (lastKey) {
      env[lastKey] += '\n' + line // multiline value continuation
    }
  }
  // Strip every marker of the *launching* environment. Claude-session vars
  // (CLAUDE_CODE_SESSION_ID / CLAUDECODE / AI_AGENT) make a spawned claude
  // quietly exit as a "nested" session. Terminal-identity vars (TERM_PROGRAM,
  // CURSOR_TRACE_ID, ITERM_* …) leak whichever terminal launched the app and
  // make claude misdetect its host — e.g. TERM_PROGRAM=vscode triggers a VS
  // Code extension auto-install that fails. This app IS the terminal; the
  // launcher's identity is always wrong. CLAUDE_CONFIG_DIR is set per account.
  for (const key of Object.keys(env)) {
    if (
      /^(CLAUDE|CLAUDECODE|ANTHROPIC|AI_AGENT|VSCODE_|ITERM_|GHOSTTY_|KITTY_|WT_|TERM_PROGRAM|CURSOR_TRACE_ID|TERMINAL_EMULATOR|LC_TERMINAL)/.test(
        key
      )
    ) {
      delete env[key]
    }
  }
  // GIT_ASKPASS/SSH_ASKPASS from a VS Code/Cursor terminal is a shim that shells
  // out to the VSCODE_GIT_ASKPASS_* vars we just stripped — left alone it fails on
  // every auth prompt. Drop it so git falls back cleanly to its credential helper.
  for (const key of ['GIT_ASKPASS', 'SSH_ASKPASS']) {
    if (/vscode|cursor/i.test(env[key] ?? '')) delete env[key]
  }
  cachedEnv = env
  return env
}

export async function claudePath(): Promise<string> {
  if (cachedClaudePath) return cachedClaudePath
  const env = await loginShellEnv()
  const { stdout } = await execFileP(SHELL, ['-lic', 'command -v claude'], { env })
  // login shells may print banners (e.g. "Restored session: ...") — take the
  // last line, and only trust it if it looks like a path
  const last = stdout.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  cachedClaudePath = last?.startsWith('/') ? last : 'claude'
  return cachedClaudePath
}

const isDefaultProfile = (configDir: string): boolean => resolve(configDir) === join(homedir(), '.claude')

/**
 * Env for talking to a specific account. The default profile (~/.claude) must
 * NOT set CLAUDE_CONFIG_DIR: with it set, claude expects .claude.json inside
 * the dir, but the default profile keeps it at ~/.claude.json.
 */
export async function envFor(configDir: string): Promise<Record<string, string>> {
  const env = { ...(await loginShellEnv()) }
  if (!isDefaultProfile(configDir)) env['CLAUDE_CONFIG_DIR'] = configDir
  // suppress the "resume from summary?" dialog on old/large `--resume`s (2.1.212:
  // shown past 70min/100k-token thresholds) — it blocks unattended restore, and a
  // queued auto-"continue" could confirm its default and /compact the session
  env['CLAUDE_CODE_RESUME_THRESHOLD_MINUTES'] = '999999999'
  env['CLAUDE_CODE_RESUME_TOKEN_THRESHOLD'] = '999999999'
  return env
}

/**
 * One session registry shared by every account — see linkSessionRegistry().
 * Deliberately outside userData: the symlinks live in the user's real account
 * dirs, so dev and packaged builds must agree on a single target.
 */
const SHARED_SESSION_REGISTRY = join(homedir(), '.agent-s-sessions')

/**
 * Make peer messaging (ListAgents / SendMessage) work ACROSS accounts.
 *
 * Claude finds peer sessions by listing `<configDir>/sessions/<pid>.json` and
 * authenticates with the `peerToken` in the sibling
 * `<pid>.<sha256(socketPath)>.key` — both scoped to CLAUDE_CONFIG_DIR. That
 * scoping is the ONLY thing separating accounts: the sockets themselves sit in
 * a machine-wide /tmp/cc-socks and the wire protocol carries no account
 * identity (verified against 2.1.245). Point every account at one registry and
 * sessions see each other regardless of which account runs them.
 *
 * Best-effort: peer messaging is a bonus, never a reason to fail a spawn.
 */
export function linkSessionRegistry(configDir: string): void {
  const link = join(configDir, 'sessions')
  try {
    mkdirSync(SHARED_SESSION_REGISTRY, { recursive: true, mode: 0o700 })
    const current = lstatSync(link, { throwIfNoEntry: false })
    if (current?.isSymbolicLink()) {
      if (resolve(configDir, readlinkSync(link)) === SHARED_SESSION_REGISTRY) return
      rmSync(link)
    } else if (current) {
      // adopt what is already there — records of live sessions included, they
      // keep writing to the same path and simply follow the link from now on
      for (const entry of readdirSync(link)) {
        renameSync(join(link, entry), join(SHARED_SESSION_REGISTRY, entry))
      }
      rmSync(link, { recursive: true })
    }
    symlinkSync(SHARED_SESSION_REGISTRY, link)
  } catch (err) {
    console.warn(`[registry] shared session registry unavailable for ${configDir}:`, err)
  }
}

let cachedScratchCwd: string | null = null
/**
 * An empty directory to run `claude` in when we only need to TALK to it (usage
 * probe, auth login) rather than work in a project. Running claude in ~ makes
 * it scan the home dir and trips macOS privacy (TCC) prompts — Downloads,
 * Music, OneDrive — all attributed to this app (idea from PR #1). The path must
 * be STABLE across launches: folder trust is recorded per-path in each
 * account's .claude.json, so a fresh mkdtemp per run would re-prompt every
 * launch and grow that file forever. tmpdir() is per-user-stable on macOS; its
 * contents may be purged, so recreate on demand.
 */
export function scratchCwd(): string {
  if (!cachedScratchCwd) {
    cachedScratchCwd = join(tmpdir(), 'agents-scratch-cwd')
    mkdirSync(cachedScratchCwd, { recursive: true })
  }
  return cachedScratchCwd
}

export interface AuthStatus {
  loggedIn: boolean
  email: string | null
  subscriptionType: string | null
}

/** `claude auth status --json` for a given config dir. Retries once — the CLI
 *  occasionally hiccups when several instances start concurrently. */
export async function authStatus(configDir: string, retry = 1): Promise<AuthStatus> {
  const env = await envFor(configDir)
  const bin = await claudePath()
  try {
    // logged out = exit code 1 WITH the JSON still on stdout (2.1.258) — that's
    // an answer, not an error; only a missing JSON block is
    const stdout = await execFileP(bin, ['auth', 'status', '--json'], { env, timeout: 30_000 }).then(
      (r) => r.stdout,
      (e: { stdout?: string }) => {
        if (typeof e.stdout === 'string' && e.stdout.includes('{')) return e.stdout
        throw e
      }
    )
    // tolerate update notices etc. around the JSON block
    const json = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1))
    return {
      loggedIn: json.loggedIn === true,
      email: json.email ?? null,
      subscriptionType: json.subscriptionType ?? null
    }
  } catch (e) {
    if (retry > 0) return authStatus(configDir, retry - 1)
    throw e
  }
}

/** The account's global config file (see envFor for the default profile). */
const claudeJsonPath = (configDir: string): string =>
  isDefaultProfile(configDir) ? join(homedir(), '.claude.json') : join(configDir, '.claude.json')

/**
 * Mark first-run onboarding as done for a logged-in account. `claude auth
 * login` (OAuth) stores the credentials but never sets `hasCompletedOnboarding`
 * — only its refresh-token path does (verified 2.1.284) — so the first session
 * on a freshly added account ran the whole onboarding, theme picker then
 * "Select login method", asking to log in all over again. Writes only when the
 * flag is missing. Best-effort: failing just means the onboarding shows.
 */
export function markOnboarded(configDir: string): void {
  try {
    const file = realpathSync(claudeJsonPath(configDir)) // a symlinked config stays shared
    const config = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (config['hasCompletedOnboarding'] === true) return
    // write-then-rename: a claude starting meanwhile never reads half a file
    const tmp = `${file}.agents-${process.pid}`
    writeFileSync(tmp, JSON.stringify({ ...config, hasCompletedOnboarding: true }, null, 2), { mode: statSync(file).mode & 0o777 })
    renameSync(tmp, file)
  } catch (err) {
    // no config yet = never logged in, nothing to fix
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[auth] could not mark ${configDir} onboarded:`, err)
  }
}

/** `claude update` — self-update the CLI (run once per app launch). Best-effort:
 *  offline, or an npm-managed install that can't self-update, just logs. */
export async function updateClaudeCli(): Promise<void> {
  try {
    const { stdout } = await execFileP(await claudePath(), ['update'], { env: await loginShellEnv(), timeout: 180_000 })
    console.log('[claude-cli] update:', stdout.trim().split('\n').at(-1))
  } catch (err) {
    console.warn('[claude-cli] update failed:', err)
  }
}

/** Log an account out (`claude auth logout`) for a given config dir. */
export async function claudeLogout(configDir: string): Promise<void> {
  await execFileP(await claudePath(), ['auth', 'logout'], { env: await envFor(configDir), timeout: 30_000 })
}

/**
 * Settings file injected via `--settings`: forwards hooks + statusline to our
 * local hook server. NEVER write into <configDir>/settings.json — profiles may
 * symlink-share it (claude-switch convention).
 */
/** tools whose call IS a dialog waiting on the user (hook matcher syntax) */
const DIALOG_TOOLS = 'AskUserQuestion|ExitPlanMode'

export function writeSessionSettings(
  dir: string,
  sessionId: string,
  hookPort: number,
  overrides?: Record<string, unknown>
): string {
  const post = (event: string): string =>
    `curl -sS -m 3 -X POST --data-binary @- http://127.0.0.1:${hookPort}/e/${sessionId}/${event}`
  const hook = (event: string) => [{ hooks: [{ type: 'command', command: post(event) }] }]
  const settings = {
    // Remote Control auto-connects every REPL to claude.ai (2.1.258+ default):
    // a cloud session gets registered and the transcript mirrored to Anthropic
    // servers. Sessions this app runs stay local unless the user opts in — per
    // session via {"remoteControlAtStartup": true} in its settings, or /rc.
    remoteControlAtStartup: false,
    // Peer messages between our own sessions are intra-app traffic: deliver
    // them instead of holding them for approval (the CLI holds whenever the
    // two sessions' permission-mode classes differ). Before the overrides —
    // this one is the user's to turn back off.
    crossSessionInbound: 'accept',
    // user overrides next (e.g. {"includeCoAuthoredBy": false}) — our
    // statusLine/hooks always win, session tracking depends on them
    ...overrides,
    statusLine: { type: 'command', command: post('statusline') },
    hooks: {
      SessionStart: hook('SessionStart'),
      UserPromptSubmit: hook('UserPromptSubmit'),
      Stop: hook('Stop'),
      Notification: hook('Notification'),
      // the model changed under the session: a user /model, or an automatic
      // fallback (safeguards refusal / overload) that stopOnFallback reacts to
      PostModelSwitch: hook('PostModelSwitch'),
      // dialogs that wait on the user without raising a Notification event
      PreToolUse: [{ matcher: DIALOG_TOOLS, ...hook('PreToolUse')[0] }],
      PostToolUse: [{ matcher: DIALOG_TOOLS, ...hook('PostToolUse')[0] }]
    }
  }
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sessionId}.json`)
  writeFileSync(file, JSON.stringify(settings))
  return file
}

/**
 * Take a transcript off its Remote Control bridge before `--resume`. The CLI
 * restores the last `bridge-session` record and reconnects that cloud session
 * on resume — `remoteControlAtStartup: false` only governs fresh sessions
 * (verified 2.1.259). `/rc` (disconnect) itself appends a record with an empty
 * bridgeSessionId, and records are last-wins, so appending that same record
 * is all it takes: O(1), no rewrite of a multi-MB file. No-op without a file.
 */
export function unbridgeTranscript(transcriptPath: string, claudeSessionId: string): void {
  if (!existsSync(transcriptPath)) return
  // a process killed mid-write can leave a partial last line — never glue onto it
  const size = statSync(transcriptPath).size
  const last = Buffer.alloc(1)
  const fd = openSync(transcriptPath, 'r')
  try {
    if (size) readSync(fd, last, 0, 1, size - 1)
  } finally {
    closeSync(fd)
  }
  const record = { type: 'bridge-session', sessionId: claudeSessionId, bridgeSessionId: '', lastSequenceNum: 0 }
  appendFileSync(transcriptPath, `${size && last[0] !== 10 ? '\n' : ''}${JSON.stringify(record)}\n`)
}

/**
 * Move a session transcript from one account's config dir to another, keeping
 * the same `projects/<encoded-cwd>/<sid>.jsonl` layout. Returns the new path.
 * We rely on the hook-provided transcriptPath instead of re-deriving the cwd
 * encoding ourselves.
 */
export function moveTranscript(transcriptPath: string, fromDir: string, toDir: string): string {
  const base = resolve(fromDir)
  const abs = resolve(transcriptPath)
  if (!abs.startsWith(base + '/')) throw new Error('transcript not under account dir')
  const rel = abs.slice(base.length + 1) // projects/<enc>/<sid>.jsonl
  const target = join(resolve(toDir), rel)
  mkdirSync(dirname(target), { recursive: true })
  // the jsonl plus its sidecar dir (<sid>/tool-results, subagent transcripts)
  const sidecar = (p: string): string => p.replace(/\.jsonl$/, '')
  for (const [from, to] of [
    [abs, target],
    [sidecar(abs), sidecar(target)]
  ]) {
    if (!existsSync(from)) continue // nothing written yet; resume will recreate
    try {
      renameSync(from, to)
    } catch {
      cpSync(from, to, { recursive: true }) // cross-device fallback
      rmSync(from, { recursive: true, force: true })
    }
  }
  return target
}

/**
 * Strip ANSI/CSI escapes so text matching is reliable. Claude's TUI positions
 * words with cursor-move codes rather than literal spaces, so patterns below use
 * `\s*` (zero-or-more) between words to tolerate the collapsed result.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC (titles, hyperlinks)
    .replace(/\x1b[()][AB0]/g, '')
}

/**
 * Whether a chunk of pty output indicates the account hit a usage limit.
 * 2.1.228 composes banners as `You've hit your <window> limit` (window ∈
 * session/weekly/Opus/Sonnet/Fable 5/usage credit) plus out-of-credit variants;
 * "fast limit" is only the fast-mode cooldown (the session keeps working on the
 * normal lane) and must NOT match. Older wordings kept for older CLIs. Wording
 * lives here so a CLI change is a one-line fix.
 */
export function detectRateLimit(text: string): { window: string; banner: string } | null {
  const s = stripAnsi(text)
  const m =
    /You.?ve\s*(?:hit|reached)\s*your\s*(?!\s*fast)([\w .$'-]{2,30}?)\s*limit[^\n]{0,60}/i.exec(s) ??
    /(You.?re\s*out\s*of\s*(?:usage\s*credits|extra\s*usage)|Your\s*org\s*is\s*out\s*of\s*usage)[^\n]{0,60}/i.exec(s) ??
    /(usage\s*limit\s*reached|5-hour\s*limit\s*reached|weekly\s*limit\s*reached|Claude\s*usage\s*limit)[^\n]{0,60}/i.exec(s)
  if (!m) return null
  // window: "session" | "weekly" | "opus" | "fable 5" | "usage credit" … (what
  // markRateLimited parks against); banner: the whole line, so a repaint of the
  // same notice (scrolling) is told apart from a new one (new reset time)
  return { window: m[1].replace(/\s+/g, ' ').trim().toLowerCase(), banner: m[0].replace(/\s+/g, ' ').trim() }
}

/**
 * The CLI asking a running SESSION to sign in — its credentials went bad while
 * `claude auth status` still reads them as fine (it only reflects local
 * storage). Same wording as `claude auth login`; chrome, never in a replay.
 */
export function isLoginPrompt(text: string): boolean {
  return /Paste\s*code\s*here\s*if\s*prompted|Opening\s*browser\s*to\s*sign\s*in|Select\s*login\s*method/i.test(stripAnsi(text))
}

/**
 * The trust prompt claude shows the first time an account opens an untrusted
 * folder — e.g. "Quick safety check: Is this a project you created or one you
 * trust?" (older builds: "Security guide" / "trust this folder"). Kept broad so
 * a wording change is a one-line fix — this MUST stay current or account-switch
 * resume hangs on the new account's prompt. ⚠️ The affirmative option is NO
 * LONGER the Enter default (see preselectsExit): a bare Enter now quits claude.
 */
export function isTrustPrompt(text: string): boolean {
  // 2.1.258 also gates project settings that carry commands behind "Managed
  // settings require approval" (Yes, I trust these settings / No, exit) — same
  // shape, same handling
  return /trust\s*this\s*folder|Security\s*guide|safety\s*check|created\s*or\s*one\s*you\s*trust|Do\s*you\s*trust|Managed\s*settings\s*require\s*approval/i.test(
    stripAnsi(text)
  )
}

/**
 * Whether a first-run prompt pre-selects the destructive "No, exit" option, so a
 * bare Enter would QUIT claude and the caller must arrow DOWN onto the
 * affirmative choice first. The current "Quick safety check" trust prompt does
 * exactly this — "❯ No, exit" is the default, "Yes, I trust this folder" the
 * line below (same shape as the bypass disclaimer). Left un-handled, an
 * account-switch resume dies on the new account's prompt. Returns false for
 * screens a plain Enter accepts (non-exiting trust variants).
 */
export function preselectsExit(text: string): boolean {
  const s = stripAnsi(text)
  // the highlighted option carries the ❯ marker — trust that over wording when
  // it's rendered ("No, continue without these permissions" also declines)
  if (/❯\s*(?:\d+\.\s*)?No,/i.test(s)) return true
  if (/❯\s*(?:\d+\.\s*)?Yes,/i.test(s)) return false
  return /No,\s*(?:exit|continue)/i.test(s)
}

/**
 * The notice claude paints after an Esc interrupt ("Interrupted · What should
 * Claude do instead?"). No Stop hook fires for an interrupt, so this is the
 * only sign the turn ended. Conversation text repaints on scroll — callers
 * must pair it with a just-pressed Esc rather than trust it on its own.
 */
export function isInterruptNotice(text: string): boolean {
  return /Interrupted\s*·?\s*What\s*should\s*Claude\s*do\s*instead/i.test(stripAnsi(text))
}

/**
 * The disclaimer claude shows at startup whenever it launches in bypass-
 * permissions mode (we restore it via `--permission-mode bypassPermissions`).
 * claude gates the mode on a `bypassPermissionsModeAccepted` config flag that it
 * only writes on a clean exit — and we SIGKILL on every switch/respawn, so it
 * never persists and this screen returns every time. The pre-selected option is
 * "1. No, exit" (NOT a plain Enter-to-accept like the trust prompt), so the
 * caller must move to "2. Yes, I accept" before confirming. Matched on the
 * warning AND an option line so a resumed transcript merely mentioning the mode
 * can't trip it.
 */
export function isBypassWarning(text: string): boolean {
  const s = stripAnsi(text)
  return /bypass\s*permissions\s*mode/i.test(s) && /Yes,\s*I\s*accept|No,\s*exit/i.test(s)
}

/**
 * Which way the TUI's input availability last flipped in a chunk of output:
 * 'modal' — a picker/panel/dialog took the screen (its "Esc to cancel/close"
 * footer, or the tabbed Status·Config·Usage·Stats panel, which has no footer
 * at all); 'ready' — the input box and its footer painted; null — neither.
 * Verified 2.1.259: a panel repaints nothing while it sits open (no footer, no
 * statusline), so the latest marker in the stream is the current state.
 */
export function tuiInputState(chunk: string): 'ready' | 'modal' | null {
  const s = stripAnsi(chunk)
  const last = (re: RegExp): number => {
    let i = -1
    for (const m of s.matchAll(re)) i = m.index
    return i
  }
  const ready = last(/\?\s*for\s*shortcuts|Try\s*"|shift\+tab\s*to\s*cycle|◉\s*agents/gi)
  const modal = last(/Esc\s*to\s*(?:cancel|close|exit|go\s*back)|Status\s*Config\s*(?:Gates\s*)?Usage\s*Stats/gi)
  if (modal < 0 && ready < 0) return null
  return modal > ready ? 'modal' : 'ready'
}

/**
 * Current permission mode from TUI output, or null when the buffer carries no
 * signal. The statusline payload does NOT include it (verified 2.1.228), but
 * the input-box footer always names the active mode ("⏸ manual mode on",
 * "⏵⏵ accept edits on", "plan mode on", "don't ask on", …) and repaints constantly — so the
 * LAST occurrence in the buffer is the current mode. Values match the CLI's
 * --permission-mode choices.
 */
export function detectPermissionMode(text: string): string | null {
  const s = stripAnsi(text)
  let mode: string | null = null
  for (const m of s.matchAll(/\b(accept\s*edits|bypass\s*permissions|don.t\s*ask)\s*on\b|\b(manual|auto|dontAsk|plan)\s*mode\s*on\b/gi)) {
    if (m[1]) mode = /accept/i.test(m[1]) ? 'acceptEdits' : /ask/i.test(m[1]) ? 'dontAsk' : 'bypassPermissions'
    else mode = /dontask/i.test(m[2]) ? 'dontAsk' : m[2].toLowerCase()
  }
  return mode
}

/**
 * Whether ultracode is active, from TUI output — true/false, or null when the
 * buffer carries no signal. The statusline can't tell (it reports ultracode as
 * plain xhigh, verified 2.1.212), so state comes from the TUI itself:
 * ON — the `✦ ultracode` input-box banner, chrome the TUI only renders while the
 * flag is live (`--resume` transcript replays and scrollback never contain it,
 * unlike the `/effort` confirmation text, which they DO replay). OFF — a
 * confirmation of switching to a plain level. Redraws replay older lines in
 * order, so the LATER of the two signals wins. Case-sensitive on purpose:
 * conversation text quoting these phrases usually differs in case; a rare exact
 * quote mislabels only until the next real signal.
 */
export function detectUltracode(text: string): boolean | null {
  const s = stripAnsi(text)
  const last = (re: RegExp): number => {
    let i = -1
    for (const m of s.matchAll(re)) i = m.index
    return i
  }
  const on = last(/✦\s*ultracode/g)
  const off = last(/Set\s*effort\s*level\s*to\s*(?:low|medium|high|xhigh|max)\b|Effort\s*level\s*set\s*to\s*auto/g)
  return on < 0 && off < 0 ? null : on > off
}

/**
 * Extract the OAuth sign-in URL from `claude auth login` output. The CLI emits it
 * as an OSC-8 terminal hyperlink (`ESC ] 8 ; ; <url> BEL`) — read the URL straight
 * out of that escape so we get one clean copy (the visible text repeats it).
 */
export function extractLoginUrl(text: string): string | null {
  // the link is ~1KB (pty reads chunk at 1KB): insist on the hyperlink's
  // terminator so a chunk split mid-URL can't hand out a truncated link whose
  // PKCE state would never match the waiting process
  const osc = text.match(/\x1b\]8;;(https?:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/)
  if (osc) return osc[1]
  const plain = text.match(/https?:\/\/[^\s'"\x1b\x07]+(?=\s)/)
  return plain ? plain[0] : null
}

// ── usage (claude's own /usage report) ──────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A dated reset — "Sep 29 at 1:30pm", "Jan 2, 2027 at 7am" — as epoch ms. The
 *  CLI formats in the machine's zone and adds the year only when it differs
 *  from the current one. */
function parseResetDate(s: string, now: Date): number | null {
  const m = /([A-Za-z]{3})\s*(\d{1,2})(?:,\s*(\d{4}))?\s*at\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(s)
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1
  if (!m || month < 0) return null
  const hour = (parseInt(m[4], 10) % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0)
  const year = m[3] ? parseInt(m[3], 10) : now.getFullYear()
  return new Date(year, month, parseInt(m[2], 10), hour, m[5] ? parseInt(m[5], 10) : 0).getTime()
}

/**
 * Parse the report `claude -p /usage` prints (verified 2.1.284):
 *   Current session: 28% used · resets Sep 29 at 1:30pm (Asia/Tokyo)
 *   Current week (all models): 8% used · resets Oct 1 at 8:59pm (Asia/Tokyo)
 *   Current week (Fable): 0% used · resets Oct 1 at 9pm (Asia/Tokyo)
 * Every reset carries its date, so one already in the past reads as a window
 * that is over — never as "the same time tomorrow". Null unless both the
 * session and the weekly line are there (API-key accounts print neither).
 */
export function parseUsageReport(text: string, now = new Date()): AccountUsage | null {
  type Window = { percent: number; resetsAt: number | null }
  let session: Window | null = null
  let weekly: Window | null = null
  const models: AccountUsage['weeklyModels'] = []
  for (const m of text.matchAll(/^Current (session|week \((.+?)\)): (\d{1,3})% used(?: · resets (.+))?$/gm)) {
    const w: Window = { percent: parseInt(m[3], 10), resetsAt: m[4] ? parseResetDate(m[4], now) : null }
    if (m[1] === 'session') session = w
    else if (m[2] === 'all models') weekly = w
    else models.push({ name: m[2].replace(/ only$/, ''), ...w }) // "(Sonnet only)" → "Sonnet"
  }
  if (!session || !weekly) return null
  return {
    fiveHour: session.percent,
    weekly: weekly.percent,
    resetsAt: session.resetsAt,
    weeklyResetsAt: weekly.resetsAt,
    weeklyModels: models,
    limitedUntil: null,
    updatedAt: now.getTime()
  }
}

/**
 * Usage exactly as claude reports it: `claude -p /usage` runs the local slash
 * command and prints a plain-text report — no model call, a second or two. The
 * TUI's /usage panel is not scraped: it paints a cached copy first and then
 * repaints only the lines that changed, so a scrape read stale numbers. The
 * undocumented oauth usage endpoint is not used either: it silently drifted to
 * zeros. Null on failure; live usage still flows from the statusline while a
 * session runs. Retries once — like `authStatus`, CLIs started concurrently
 * occasionally fail.
 */
export async function fetchUsage(configDir: string, retry = 1): Promise<AccountUsage | null> {
  const [bin, env] = await Promise.all([claudePath(), envFor(configDir)])
  let out = ''
  try {
    // no transcript for the probe; the scratch cwd keeps claude out of ~
    const run = execFileP(bin, ['-p', '/usage', '--no-session-persistence'], { env, cwd: scratchCwd(), timeout: 60_000 })
    run.child.stdin?.end() // print mode reads stdin as extra prompt input until EOF
    out = (await run).stdout
    const usage = parseUsageReport(out)
    if (usage) return usage
  } catch (err) {
    out = String(err)
  }
  if (retry > 0) return fetchUsage(configDir, retry - 1)
  console.warn(`[usage] no /usage report for ${configDir}: ${out.trim().slice(0, 200)}`)
  return null
}

/** CLI args for launching a session's claude process. model/effort/mode are all
 *  per-process in the CLI — every respawn (stop→resume, account switch, limit
 *  restart) must carry them back or the session silently reverts to defaults
 *  (live-hit: /effort max degraded to xhigh after a switch). Flags, not slash
 *  commands: `/model` pops a "re-read history?" confirm dialog on resumes. */
export function sessionArgs(opts: {
  settingsFile: string
  launchArgs: string
  resumeSessionId?: string | null
  model?: string | null
  effort?: string | null
  permissionMode?: string | null
  addDirs?: string[]
  appendSystemPrompt?: string | null
}): string[] {
  const args = ['--settings', opts.settingsFile]
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId)
  if (opts.model) args.push('--model', opts.model)
  // the flag only accepts plain levels — ultracode is re-applied via /effort
  if (opts.effort && opts.effort !== 'ultracode') args.push('--effort', opts.effort)
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode)
  for (const d of opts.addDirs ?? []) args.push('--add-dir', expandHome(d))
  // one argv element — content with spaces/newlines needs no shell quoting here
  // snapshot off: since CLI 2.1.267 the system prompt is recorded once per
  // conversation and replayed verbatim on --resume, so edited prompt files
  // would be ignored on every respawn (stop→resume, account switch)
  if (opts.appendSystemPrompt) {
    args.push('--append-system-prompt', opts.appendSystemPrompt, '--system-prompt-snapshot', 'off')
  }
  const extra = opts.launchArgs.trim()
  if (extra) args.push(...extra.split(/\s+/))
  return args
}

/** no shell in the spawn path, so `~/…` form inputs must be expanded here */
const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** Concatenated contents of the session's system-prompt files, read fresh on
 *  every spawn so edits apply on the next start; missing files are skipped. */
export function readSystemPrompt(paths: string[]): string | null {
  const parts: string[] = []
  for (const p of paths) {
    try {
      parts.push(readFileSync(expandHome(p), 'utf8'))
    } catch {
      /* gone/unreadable — skip */
    }
  }
  const joined = parts.join('\n\n').trim()
  return joined || null
}

/** Parse the user's settings-overrides JSON (validated in the form); anything
 *  invalid degrades to undefined here rather than blocking a spawn. */
export function parseSettingsOverrides(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
