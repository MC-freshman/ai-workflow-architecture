"""Close unfinished protocol probes from one owned, cancelled matrix attempt."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def no_links(path):
    for item in (path, *path.parents):
        try:
            metadata = item.lstat()
        except FileNotFoundError:
            continue
        if item.is_symlink() or getattr(metadata, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Cancelled matrix cleanup cannot traverse a link')


def main(config_path, output_path):
    config_path = Path(config_path); output = Path(output_path)
    no_links(config_path); no_links(output)
    trusted = read(config_path)
    output.resolve().relative_to((Path(trusted['platformRoot']) / 'runtime/manager-check').resolve())
    matrix_config = output / 'matrix-runs/config.json'
    rows = []
    if matrix_config.is_file():
        no_links(matrix_config)
        runs = output / 'matrix-runs/runs'
        expected = {**trusted, 'runsRoot': str(runs)}
        observed = read(matrix_config)
        if observed != expected:
            raise ValueError('Cancelled matrix configuration differs from its trusted target')
        requests = output / 'cancel-cleanup'; requests.mkdir(exist_ok=True)
        for directory in sorted(runs.iterdir()):
            no_links(directory)
            state_path = directory / 'state.json'
            if not state_path.is_file():
                continue
            no_links(state_path); state = read(state_path)
            if state['status'] in ('stopped', 'succeeded', 'failed'):
                continue
            if not directory.name.startswith('matrix-'):
                raise ValueError('Unexpected run in the owned matrix attempt')
            stamp = str(time.time_ns())
            request = {'schemaVersion': 'ai-run-protocol/v1.1', 'kind': 'request',
                       'requestId': 'matrix-cancel-' + stamp, 'operation': 'stop',
                       'runId': directory.name, 'idempotencyKey': 'matrix-cancel-' + stamp,
                       'expectedStateRevision': state['stateRevision'],
                       'payload': {'reason': 'Cancelled onboarding maintenance probe; no business submit'}}
            path = requests / (stamp + '.json')
            path.write_text(json.dumps(request), encoding='utf-8')
            answer = subprocess.run([sys.executable, '-B', str(Path(trusted['runner']) / 'cli.py'),
                                     '--config', str(matrix_config), '--request', str(path)],
                                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                                    timeout=90, env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'})
            response = json.loads(answer.stdout.strip().splitlines()[-1])
            after = read(state_path)
            rows.append({'runId': directory.name, 'before': state['status'], 'after': after['status'],
                         'responseOk': response.get('ok'), 'exitCode': answer.returncode})
    report = {'schema': 'architecture-manager-matrix-cleanup/v1', 'platformId': trusted['platform'],
              'configSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(), 'rows': rows,
              'ok': all(row['responseOk'] and row['after'] == 'stopped' for row in rows),
              'businessStagesExecuted': False, 'otherPlatformRunsTouched': False}
    path = output / 'cancel-cleanup.json'; path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'ok': report['ok'], 'evidencePath': str(path), 'stopped': len(rows)}))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
