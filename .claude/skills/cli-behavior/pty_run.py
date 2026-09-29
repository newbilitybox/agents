#!/usr/bin/env python3
"""Run the claude TUI in a pty, type inputs once it is ready, save the raw output.

usage: pty_run.py <cwd> <configDir> <outFile> [claude args...] [-- input...]

- <configDir> becomes CLAUDE_CONFIG_DIR (the default ~/.claude profile keeps it
  unset, like the app's envFor()); an empty directory shows a fresh account.
- Each input is typed, then Enter a beat later (a same-write CR gets swallowed).
- The folder-trust prompt is passed with Down+Enter: its default is "No, exit".
- XTVERSION queries are answered as xterm.js, the terminal the app emulates.
"""
import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time

READY = r'\?\s*for\s*shortcuts|shift\+tab\s*to\s*cycle|Try\s*"'
TRUST = r'trust\s*this\s*folder|safety\s*check|Do\s*you\s*trust'


def main() -> None:
    cwd, config_dir, out_file = sys.argv[1], os.path.expanduser(sys.argv[2]), sys.argv[3]
    args = sys.argv[4:]
    inputs: list[str] = []
    if '--' in args:
        k = args.index('--')
        args, inputs = args[:k], args[k + 1:]

    # launched from inside a claude session, these make claude exit as "nested"
    env = {k: v for k, v in os.environ.items()
           if not re.match(r'^(CLAUDE|CLAUDECODE|ANTHROPIC|AI_AGENT|VSCODE_|ITERM_|GHOSTTY_|KITTY_|WT_|'
                           r'TERM_PROGRAM|CURSOR_TRACE_ID|TERMINAL_EMULATOR|LC_TERMINAL)', k)}
    if os.path.realpath(config_dir) != os.path.realpath(os.path.expanduser('~/.claude')):
        env['CLAUDE_CONFIG_DIR'] = config_dir
    env['TERM'] = 'xterm-256color'

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execve(os.path.expanduser('~/.local/bin/claude'), ['claude', *args], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))

    buf = b''

    def pump(seconds: float) -> None:
        nonlocal buf
        end = time.time() + seconds
        while time.time() < end:
            if not select.select([fd], [], [], 0.2)[0]:
                continue
            try:
                data = os.read(fd, 65536)
            except OSError:  # claude exited
                return
            buf += data
            if b'\x1b[>0q' in data or b'\x1b[>q' in data:
                os.write(fd, b'\x1bP>|xterm.js(5.5.0)\x1b\\')

    def text() -> str:
        return re.sub(r'\x1b\[[0-9;?]*[a-zA-Z]', '', buf.decode('utf-8', 'replace'))

    trusted = False
    deadline = time.time() + 30
    while time.time() < deadline:
        pump(0.5)
        if not trusted and re.search(TRUST, text()):
            trusted = True
            os.write(fd, b'\x1b[B')
            time.sleep(0.2)
            os.write(fd, b'\r')
            continue
        if re.search(READY, text()):
            break

    for item in inputs:
        os.write(fd, item.encode())
        time.sleep(0.4)
        os.write(fd, b'\r')
        pump(4)
    pump(1)

    with open(out_file, 'wb') as f:
        f.write(buf)
    os.kill(pid, 9)
    print(f'captured {len(buf)} bytes → {out_file}')


if __name__ == '__main__':
    main()
