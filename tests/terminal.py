#!/usr/bin/env python3
"""Run a command in a terminal of its own and type keys into it. Used to test install.sh.

    terminal.py <keys> <command> [args...]

<keys> is a comma separated list, typed one at a time once the command has printed
something: enter, space, up, down, or any other text as it is. Prints what the command
printed and exits with its exit code.
"""
import os
import pty
import select
import sys
import time

KEYS = {"enter": "\r", "space": " ", "up": "\033[A", "down": "\033[B"}


def read(master, wait):
    """Everything the command prints until it has been quiet for `wait` seconds."""
    seen = b""
    while select.select([master], [], [], wait)[0]:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            break
        if not chunk:
            break
        seen += chunk
    return seen


def main():
    keys = [key for key in sys.argv[1].split(",") if key]
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[2], sys.argv[2:])

    printed = read(master, 3.0)
    for key in keys:
        os.write(master, KEYS.get(key, key).encode())
        time.sleep(0.3)
        printed += read(master, 0.5)
    printed += read(master, 5.0)

    _, status = os.waitpid(pid, 0)
    sys.stdout.write(printed.decode(errors="replace"))
    sys.exit(os.waitstatus_to_exitcode(status))


main()
