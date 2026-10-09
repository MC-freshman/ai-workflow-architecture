"""Own one Linux preparation command and stop its whole process group on cancellation."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

spec_path = Path(sys.argv[1])
spec = json.loads(spec_path.read_text())
child = subprocess.Popen(spec['argv'], start_new_session=True, env={**os.environ, **spec.get('environment', {})})
record = spec_path.with_name('process.json')
record.write_text(json.dumps({'pid': child.pid, 'owned': True, 'startedAt': time.time()}))
try:
    while child.poll() is None:
        if spec_path.with_name('cancel.flag').exists():
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            sys.exit(125)
        time.sleep(.05)
    sys.exit(child.returncode)
finally:
    record.write_text(json.dumps({'pid': child.pid, 'ended': child.poll() is not None, 'endedAt': time.time()}))
