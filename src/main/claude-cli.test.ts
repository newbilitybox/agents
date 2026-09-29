import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectRateLimit, markOnboarded, parseUsageReport } from './claude-cli.ts'

const at = (y: number, mon: number, d: number, h: number, min = 0): number => new Date(y, mon - 1, d, h, min).getTime()
const NOW = new Date(2026, 8, 29, 9, 33) // Sep 29 2026, 09:33 local

// `claude -p /usage` as printed by 2.1.284 (local times, so the tz suffix is ours)
const REPORT = `You are currently using your subscription to power your Claude Code usage

Current session: 28% used · resets Sep 29 at 1:30pm (Asia/Tokyo)
Current week (all models): 8% used · resets Oct 1 at 8:59pm (Asia/Tokyo)
Current week (Fable): 0% used · resets Oct 1 at 9pm (Asia/Tokyo)

What's contributing to your limits usage?
Last 24h · 1806 requests · 2 sessions
  90% of your usage was at >150k context`

test('parseUsageReport reads the session, weekly and per-model windows', () => {
  assert.deepEqual(parseUsageReport(REPORT, NOW), {
    fiveHour: 28,
    weekly: 8,
    resetsAt: at(2026, 9, 29, 13, 30),
    weeklyResetsAt: at(2026, 10, 1, 20, 59),
    weeklyModels: [{ name: 'Fable', percent: 0, resetsAt: at(2026, 10, 1, 21) }],
    limitedUntil: null,
    updatedAt: NOW.getTime()
  })
})

test('a reset that already passed stays in the past (the window is over), never rolls to tomorrow', () => {
  const u = parseUsageReport('Current session: 100% used · resets Sep 29 at 9:29am (Asia/Tokyo)\nCurrent week (all models): 13% used · resets Oct 6 at 6:59am (Asia/Tokyo)', NOW)
  assert.equal(u?.resetsAt, at(2026, 9, 29, 9, 29))
})

test('an explicit year is honoured; "(X only)" windows are keyed by the model name', () => {
  const u = parseUsageReport(
    'Current session: 5% used\nCurrent week (all models): 40% used · resets Jan 2, 2027 at 7am (Asia/Tokyo)\nCurrent week (Sonnet only): 12% used · resets Jan 2, 2027 at 7am (Asia/Tokyo)',
    NOW
  )
  assert.equal(u?.resetsAt, null) // no active window → no reset line
  assert.equal(u?.weeklyResetsAt, at(2027, 1, 2, 7))
  assert.deepEqual(u?.weeklyModels, [{ name: 'Sonnet', percent: 12, resetsAt: at(2027, 1, 2, 7) }])
})

test('anything without both the session and weekly lines is not a usage report', () => {
  assert.equal(parseUsageReport('Total cost: $0.0000\nUsage: 0 input, 0 output', NOW), null)
  assert.equal(parseUsageReport('Current session: 3% used · resets Sep 29 at 1:30pm', NOW), null)
})

// `claude auth login` leaves a fresh profile un-onboarded, so its first session
// runs the theme picker and "Select login method" again
const freshLogin = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-test-'))
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ numStartups: 1, oauthAccount: { accountUuid: 'u1' } }, null, 2), { mode: 0o600 })
  return dir
}

test('markOnboarded completes onboarding and keeps the rest of the config and its 0600 mode', () => {
  const dir = freshLogin()
  markOnboarded(dir)
  const file = join(dir, '.claude.json')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { numStartups: 1, oauthAccount: { accountUuid: 'u1' }, hasCompletedOnboarding: true })
  assert.equal(statSync(file).mode & 0o777, 0o600)
})

test('markOnboarded writes through a symlinked config instead of replacing the link', () => {
  const real = freshLogin()
  const dir = mkdtempSync(join(tmpdir(), 'agents-test-'))
  symlinkSync(join(real, '.claude.json'), join(dir, '.claude.json'))
  markOnboarded(dir)
  assert.ok(lstatSync(join(dir, '.claude.json')).isSymbolicLink())
  assert.equal(JSON.parse(readFileSync(join(real, '.claude.json'), 'utf8')).hasCompletedOnboarding, true)
})

test('markOnboarded leaves a profile without a config alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-test-'))
  markOnboarded(dir)
  assert.throws(() => statSync(join(dir, '.claude.json')))
})

test('a limit banner parks until the reset it states itself', () => {
  const hit = detectRateLimit("\x1b[31mYou've hit your session limit · resets 10:30am (Asia/Tokyo)\x1b[0m", NOW)
  assert.deepEqual(
    { window: hit?.window, resetsAt: hit?.resetsAt, key: hit?.key },
    { window: 'session', resetsAt: at(2026, 9, 29, 10, 30), key: 'session|10:30am' }
  )
  const weekly = detectRateLimit("You've hit your weekly limit · resets Oct 1 at 9pm (Asia/Tokyo)", NOW)
  assert.deepEqual([weekly?.window, weekly?.resetsAt], ['weekly', at(2026, 10, 1, 21)])
  assert.equal(detectRateLimit("You've hit your Fable 5 limit · resets Oct 1 at 9pm", NOW)?.window, 'fable 5')
  assert.equal(detectRateLimit("You're out of usage credits · resets 9:30am (Asia/Tokyo) · progress saved", NOW)?.window, 'usage credits')
})

test('a time-only reset is the next such time, unless it has only just passed', () => {
  const lateNight = new Date(2026, 8, 29, 23, 55)
  assert.equal(detectRateLimit("You've hit your session limit · resets 12:05am", lateNight)?.resetsAt, at(2026, 9, 30, 0, 5))
  const justAfter = new Date(2026, 8, 29, 9, 31)
  assert.equal(detectRateLimit("You've hit your session limit · resets 9:30am", justAfter)?.resetsAt, at(2026, 9, 29, 9, 30))
})

test('the same hit keeps its identity across repaints and --resume replays', () => {
  const fresh = detectRateLimit("You've hit your session limit · resets 9:30am (Asia/Tokyo)", NOW)
  // a replayed copy with the words glued by cursor moves and other text after it
  // (the banner a 0.2.29 session persisted, verbatim)
  const replay = detectRateLimit("You'vehityour sessionlimit·resets9:30am(Asia/Tokyo)(errortyperate_limit,HTTP429,reques", NOW)
  assert.ok(fresh && replay)
  assert.equal(replay.key, fresh.key)
  assert.notEqual(detectRateLimit("You've hit your session limit · resets 2:30pm", NOW)?.key, fresh.key)
})

test('neither the fast-mode cooldown nor the CLI\'s own auto-continue notice is a limit hit', () => {
  assert.equal(detectRateLimit("You've hit your fast limit · resets in 3m", NOW), null)
  assert.equal(detectRateLimit('Usage limit reached · continuing automatically at 9:30am · esc to cancel', NOW), null)
})
