// Launch the built app (out/) under Playwright for end-to-end checks — see SKILL.md.
//   const t = await launch({ dataDir: '<scratchpad>/userdata' })
//   await t.win.evaluate(() => window.api.getState())
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const { _electron } = createRequire(join(ROOT, 'package.json'))('playwright-core')

// launched from inside a claude session, these make every claude the app spawns
// exit at once as a "nested" session, and misname the terminal it runs in
const LAUNCHER_ENV = /^(CLAUDE|CLAUDECODE|ANTHROPIC|AI_AGENT|VSCODE_|ITERM_|GHOSTTY_|KITTY_|WT_|TERM_PROGRAM|CURSOR_TRACE_ID|TERMINAL_EMULATOR|LC_TERMINAL)/

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** resolve with fn()'s first truthy value, polling every 500 ms */
export async function poll(what, fn, timeout = 60_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(500)
  }
  throw new Error(`timeout: ${what}`)
}

export const plain = (text) => text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')

/** `dataDir` isolates the store and the single-instance lock from the user's
 *  dev and packaged apps; a config.json put there first seeds the state. */
export async function launch({ dataDir, env = {} }) {
  const app = await _electron.launch({
    executablePath: join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [ROOT],
    cwd: ROOT,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !LAUNCHER_ENV.test(k))),
      AGENTS_USER_DATA_DIR: dataDir,
      ...env
    }
  })
  const mainLog = []
  for (const stream of [app.process().stdout, app.process().stderr]) stream.on('data', (d) => mainLog.push(String(d)))
  const win = await app.firstWindow()
  await win.waitForFunction(() => !!window.api)
  const state = () => win.evaluate(() => window.api.getState())
  return {
    app,
    win,
    /** everything the main process printed so far */
    mainLog,
    state,
    session: async (id) => (await state()).sessions.find((s) => s.id === id),
    /** the session's terminal output as plain text */
    screen: async (id) => plain((await win.evaluate((id) => window.api.ptySnapshot(id), id)).data),
    /** post a hook event as the session's claude would (Stop, Notification…) */
    hook: async (id, event, payload = {}) => {
      const settings = readFileSync(join(dataDir, 'session-settings', `${id}.json`), 'utf8')
      const port = /127\.0\.0\.1:(\d+)/.exec(settings)[1]
      await fetch(`http://127.0.0.1:${port}/e/${id}/${event}`, { method: 'POST', body: JSON.stringify(payload) })
    },
    close: () => app.close()
  }
}
