/**
 * Typed IPC contract between main and renderer.
 * Every channel is declared here once; both sides import from this file.
 */
import type { Account, ModelOption, Session } from './types'

/** editable-after-creation session config (README: "後期隨時可以改") */
export interface SessionConfigPatch {
  title?: string
  autoSwitch?: boolean
  launchArgs?: string
  /** null = CLI default; changes apply on the next (re)spawn — updateConfig
   *  restarts a non-running session right away to make them stick */
  modelId?: string | null
  effort?: string | null
  mode?: string | null
  systemPromptFiles?: string[]
  addDirs?: string[]
  addDirClaudeMd?: boolean
  settingsJson?: string
  stopOnFallback?: boolean
}

/** what a sign-in is for: logging the account in (`claude auth login`), or
 *  generating a long-lived token for it (`claude setup-token`) */
export type LoginPurpose = 'login' | 'token'

/** what `claude auth login` / `claude setup-token` offers, off one pty */
export interface LoginLinks {
  /** copy-anywhere link: the code it ends with is pasted back (or typed into the terminal) */
  manualUrl: string
  /** same sign-in, but redirecting to the CLI's localhost callback — completes by
   *  itself when opened on this machine; null if the CLI didn't ask for a browser */
  browserUrl: string | null
  /** pty id of the login process, for the dialog's embedded terminal */
  ptyId: string
}

export interface LoginResult {
  ok: boolean
  /** the CLI's own verdict line ("Invalid code…", "Login failed…"), if it printed one */
  message: string | null
}

/** account fields the user can register/edit */
export interface NewAccountInput {
  name: string
  /** empty → defaults to ~/.claude-<name> */
  path: string
  note: string
  /** a long-lived token to run the account on, instead of a local login */
  token?: string
  /** epoch ms that token expires, when the user knows it */
  tokenExpiresAt?: number | null
}

/** Runtime view of a session (persisted fields + live pty info). */
export interface SessionView extends Session {
  /** pty process is alive */
  alive: boolean
  cols: number
  rows: number
}

export interface AppState {
  accounts: Account[]
  sessions: SessionView[]
  /** recently used launch-args strings, most-recent first (max 10) */
  recentLaunchArgs: string[]
  /** models the statusline has reported (any session, ever) — extra picker options */
  knownModels: ModelOption[]
}

export interface NewSessionInput {
  cwd: string
  /** run in a git worktree of its own (fixed at creation) */
  worktree: boolean
  /** empty → auto-pick a logged-in account with the most headroom */
  accountDir: string
  title: string
  autoSwitch: boolean
  /** raw CLI args string, split on whitespace */
  launchArgs: string
  /** null = CLI default */
  modelId: string | null
  effort: string | null
  mode: string | null
  systemPromptFiles: string[]
  addDirs: string[]
  addDirClaudeMd: boolean
  settingsJson: string
  stopOnFallback: boolean
}

export interface PtyDataEvent {
  id: string
  data: string
  /** cumulative output length after this chunk — used to dedupe vs snapshot */
  end: number
}

export interface PtySnapshot {
  data: string
  end: number
}

/** invoke-style API (renderer → main) plus event subscriptions (main → renderer) */
export interface IpcApi {
  getAppInfo(): Promise<{ version: string; electron: string; platform: string }>
  getState(): Promise<AppState>
  pickDirectory(): Promise<string | null>
  /** multi-select file picker (for system-prompt files) */
  pickFiles(): Promise<string[]>

  // accounts
  discoverAccounts(): Promise<void>
  registerAccount(input: NewAccountInput): Promise<void>
  updateAccountNote(configDir: string, note: string): Promise<void>
  /** re-check auth and (best-effort) refresh usage for one account */
  refreshAuth(configDir: string): Promise<void>
  /** refresh usage for all logged-in accounts (may prompt for Keychain access) */
  refreshAllUsage(): Promise<void>
  /** start the sign-in for `purpose` (default: login); resolves with its links (no browser opens by itself) */
  startLogin(configDir: string, purpose?: LoginPurpose): Promise<LoginLinks>
  /** submit the pasted code; ok once the account is logged in / its new token is stored */
  submitLoginCode(configDir: string, code: string): Promise<LoginResult>
  /** the account's stored long-lived token itself (state only carries `Account.token`) */
  revealAccountToken(configDir: string): Promise<string | null>
  /** store a token the user pasted, replacing the account's current one */
  setAccountToken(configDir: string, token: string, expiresAt: number | null): Promise<void>
  /** abort an in-progress login (dialog closed) */
  cancelLogin(configDir: string): Promise<void>
  /** log an account out */
  logout(configDir: string): Promise<void>
  removeAccount(configDir: string): Promise<void>

  // sessions
  createSession(input: NewSessionInput): Promise<string>
  restartSession(id: string): Promise<void>
  /** stop a running session without removing it (becomes an exited, resumable card) */
  stopSession(id: string): Promise<void>
  /** the session's view is in front of the user: its finished turn (done) counts as seen → idle */
  markSessionSeen(id: string): Promise<void>
  removeSession(id: string): Promise<void>
  /** move the session to another account (only when idle): move transcript + resume */
  switchAccount(id: string, targetAccountDir: string): Promise<void>
  updateSessionConfig(id: string, patch: SessionConfigPatch): Promise<void>
  reorderSessions(orderedIds: string[]): Promise<void>
  /** persist the chat-input draft (debounced) so it survives an app restart */
  saveDraft(id: string, text: string): Promise<void>
  /** save an image blob to a temp file, return its path (for chat paste) */
  savePastedImage(bytes: Uint8Array, ext: string): Promise<string>
  ptyWrite(id: string, data: string): Promise<void>
  /** submit a chat message (bracketed paste + Enter). Resolves once it is typed
   *  into claude — which may wait for claude to boot or a dialog to close — and
   *  rejects if it is dropped before that */
  ptySubmit(id: string, text: string): Promise<void>
  ptyResize(id: string, cols: number, rows: number): Promise<void>
  ptySnapshot(id: string): Promise<PtySnapshot>

  // windowing
  popOutSession(id: string): Promise<void>
  focusPoppedOut(id: string): Promise<void>

  /**
   * A file drop, resolved in the preload (where webUtils works). `sessionId` is
   * the card the file was dropped on (from its data-session-id), or null.
   */
  onFileDrop(cb: (drop: { sessionId: string | null; paths: string[] }) => void): () => void

  // events; all return an unsubscribe fn
  onStateChanged(cb: (state: AppState) => void): () => void
  onPtyData(cb: (ev: PtyDataEvent) => void): () => void
  /** main asks the renderer to focus a session (notification click) */
  onFocusSession(cb: (id: string) => void): () => void
  /** main asks the renderer to open Settings (menu ⌘,) */
  onOpenSettings(cb: () => void): () => void
}

export const INVOKE_CHANNELS = [
  'getAppInfo',
  'getState',
  'pickDirectory',
  'pickFiles',
  'discoverAccounts',
  'registerAccount',
  'updateAccountNote',
  'refreshAuth',
  'refreshAllUsage',
  'startLogin',
  'submitLoginCode',
  'revealAccountToken',
  'setAccountToken',
  'cancelLogin',
  'logout',
  'removeAccount',
  'createSession',
  'restartSession',
  'stopSession',
  'markSessionSeen',
  'removeSession',
  'switchAccount',
  'updateSessionConfig',
  'reorderSessions',
  'saveDraft',
  'savePastedImage',
  'ptyWrite',
  'ptySubmit',
  'ptyResize',
  'ptySnapshot',
  'popOutSession',
  'focusPoppedOut'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_STATE = 'ev:state'
export const EVENT_PTY_DATA = 'ev:ptyData'
export const EVENT_FOCUS_SESSION = 'ev:focusSession'
export const EVENT_OPEN_SETTINGS = 'ev:openSettings'

export const ipcChannel = (method: InvokeChannel): string => `app:${method}`

declare global {
  interface Window {
    api: IpcApi
  }
}
