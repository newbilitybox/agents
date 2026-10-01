import Store from 'electron-store'
import type { Account, ModelOption, Session } from '../shared/types'

/** an account's long-lived token (`claude setup-token`), value included */
export interface StoredToken {
  configDir: string
  value: string
  /** epoch ms it was generated here; null for a pasted token */
  createdAt: number | null
  /** epoch ms it stops working; null when unknown */
  expiresAt: number | null
}

interface Schema {
  accounts: Account[]
  /** kept apart from `accounts`, which is broadcast to the renderer whole —
   *  token values only leave the main process when asked for */
  tokens: StoredToken[]
  sessions: Session[]
  /** recently used launch-args strings, most-recent first (max 10) */
  recentLaunchArgs: string[]
  /** every model the statusline has ever reported — the model picker lists
   *  these after its built-in presets, so a new release needs no app update */
  knownModels: ModelOption[]
}

export type AppStore = Store<Schema>

export function createStore(): AppStore {
  return new Store<Schema>({
    defaults: { accounts: [], tokens: [], sessions: [], recentLaunchArgs: [], knownModels: [] },
    // it holds account tokens in plain text (DECISIONS.md, 2026-10-01)
    configFileMode: 0o600
  })
}

const MAX_RECENT = 10

/** Record a launch-args string as most-recently-used (dedup, capped). */
export function pushRecentLaunchArgs(store: AppStore, args: string): void {
  const trimmed = args.trim()
  if (!trimmed) return
  const next = [trimmed, ...(store.get('recentLaunchArgs') ?? []).filter((a) => a !== trimmed)]
  store.set('recentLaunchArgs', next.slice(0, MAX_RECENT))
}
