import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markOnboarded, parseUsageReport } from './claude-cli.ts'

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
