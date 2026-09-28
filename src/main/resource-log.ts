/**
 * Resource self-check: one line per usage sweep (startup, every 15 min, panel
 * open) appended to <userData>/resources.log. macOS has a small machine-wide
 * pty pool (kern.tty.ptmx_max — 511 on current Macs) shared by every terminal
 * app; when Terminal/iTerm suddenly cannot open a window, this log tells
 * whether we were the one filling it and since when. Cost: one readdir + one
 * `ps` per sweep.
 *   pty      = ptys allocated machine-wide / pool size
 *   procs    = processes owned by the user
 *   children = direct children of this process (sessions + probes still alive)
 *   fds      = open file descriptors of this process
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const LOG_CAP = 256 * 1024 // ~100 bytes per line: years of history; halved when reached
let ptyMax = 0

export async function logResources(): Promise<void> {
  try {
    ptyMax ||= parseInt((await execFileP('sysctl', ['-n', 'kern.tty.ptmx_max'])).stdout, 10) || 0
    const ptys = readdirSync('/dev').filter((n) => /^ttys\d{3}$/.test(n)).length
    const ppids = (await execFileP('ps', ['-U', String(userInfo().uid), '-o', 'ppid='])).stdout.trim().split('\n')
    const children = ppids.filter((p) => Number(p) === process.pid).length
    const fds = readdirSync('/dev/fd').length
    const line = `${new Date().toISOString()} pty=${ptys}/${ptyMax} procs=${ppids.length} children=${children} fds=${fds}\n`
    const file = join(app.getPath('userData'), 'resources.log')
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_CAP) {
      const old = readFileSync(file, 'utf8')
      writeFileSync(file, old.slice(old.indexOf('\n', old.length / 2) + 1))
    }
    appendFileSync(file, line)
    if (ptyMax && ptys > ptyMax * 0.8) console.warn(`[resources] pty pool ${ptys}/${ptyMax} — terminals may stop opening soon`)
  } catch (e) {
    console.warn('[resources] self-check failed:', String(e))
  }
}
