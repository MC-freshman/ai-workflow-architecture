"""zcode platform session provider (R-P5, D-90).

The shared connector names three questions - launch, liveness, terminate - and this platform
answers them here so the shared code never names an operating-system API. Exit code is the whole
answer for liveness/terminate (0 = alive / terminated); launch prints one JSON line with the new pid.

  --launch   <body-path> [args...]   start the program detached, print {"pid": N}
  --alive    <pid>                    exit 0 when the process exists
  --terminate <pid>                   terminate it; exit 0 when gone

Windows notes: launch uses DETACHED_PROCESS only - CREATE_NEW_CONSOLE and DETACHED_PROCESS are
mutually exclusive and pass both fail with ERROR_INVALID_PARAMETER (D-90-era field note). Liveness
and terminate go through tasklist/taskkill so no handle opened here can keep a dying process alive.
"""
import json
import subprocess
import sys


def _alive(pid):
    proc = subprocess.run(['tasklist', '/FI', 'PID eq %d' % pid, '/NH'],
                          capture_output=True, text=True)
    return str(pid) in (proc.stdout or '')


def launch(body, args):
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen([body] + list(args), creationflags=flags, close_fds=True)
    print(json.dumps({'pid': proc.pid}))


def terminate(pid):
    subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True, text=True)
    sys.exit(0 if not _alive(pid) else 1)


def main():
    argv = sys.argv[1:]
    if not argv:
        print('usage: session-process-windows.py --launch <body> [args...] | --alive <pid> | --terminate <pid>',
              file=sys.stderr)
        sys.exit(2)
    mode = argv[0]
    if mode == '--launch':
        if len(argv) < 2:
            sys.exit(2)
        launch(argv[1], argv[2:])
    elif mode == '--alive':
        sys.exit(0 if _alive(int(argv[1])) else 1)
    elif mode == '--terminate':
        terminate(int(argv[1]))
    else:
        sys.exit(2)


if __name__ == '__main__':
    main()
