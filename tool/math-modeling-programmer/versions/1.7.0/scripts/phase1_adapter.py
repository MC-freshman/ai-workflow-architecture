"""Execute a single prepared domain stage; never invent model/review output."""
import json
from pathlib import Path
import subprocess
import sys

import math_checks

ROOT = Path('/work')
SCRIPTS = Path(__file__).resolve().parent


def run(script, *args):
    result = subprocess.run([sys.executable, '-B', str(SCRIPTS / script), *map(str, args)], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        print(result.stdout, file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(script + ' failed')
    return result.stdout


def main(stage):
    config = math_checks.read(ROOT, 'phase1.json')
    if stage == 'INIT':
        if (ROOT / 'project_manifest.json').exists() or (ROOT / 'stage_state.json').exists():
            raise ValueError('INIT refuses an existing domain state')
        run('init_project.py', ROOT, '--project-id', config['projectId'])
    else:
        math_checks.state_pair(ROOT, math_checks.STAGES[math_checks.STAGES.index(stage) - 1])
        if stage == 'AUDIT':
            run('audit_data.py', ROOT / config['dataFile'], '--output-dir', ROOT / 'reports')
        elif stage in ('BASELINE', 'SOLVE'):
            entry = config['baselineEntry'] if stage == 'BASELINE' else config['solverEntry']
            result = subprocess.run([sys.executable, '-B', str(math_checks.path(ROOT, entry))], cwd=ROOT, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(entry + ' failed: ' + result.stderr[-2000:])
        elif stage == 'EXPERIMENT':
            run('run_experiments.py', ROOT / 'configs/experiment.json', '--project', ROOT, '--timeout', '60')
        elif stage == 'VALIDATE':
            independent = subprocess.run([sys.executable, '-B', str(math_checks.path(ROOT, config.get('validationEntry', 'src/validate.py')))], cwd=ROOT)
            if independent.returncode:
                raise RuntimeError('Independent numerical validation failed')
            run('run_validations.py', ROOT / 'configs/validation.json', '--project', ROOT)
        if stage == 'SOLVE':
            solution = math_checks.read(ROOT, 'results/solution.json')
            spec = math_checks.specification(ROOT)
            registration = config.get('resultRegistration', {})
            metric = registration.get('metric', config.get('baselineMetric', 'mse'))
            run('register_result.py', '--project', ROOT, '--problem-id', registration.get('problemId', 'P1'), '--experiment-id', registration.get('experimentId', 'EXP-001'), '--claim', registration.get('claim', str(spec['objective'])), '--value', str(solution[metric]), '--unit', registration.get('unit', str(spec['units'])), '--method', registration.get('method', 'confirmed-model'), '--evidence', 'results/solution.json', '--code-module', config['solverEntry'], '--input', config['dataFile'], '--config', 'model_spec.yaml', '--status', 'CHECKED')
        if stage == 'FIGURES':
            # Rendering and visual review occur before this acceptance call so
            # the reviewer examines the exact preview whose hashes are checked.
            run('check_figures.py', '--project', ROOT)
        math_checks.check(ROOT, stage, before_advance=True)
        result = json.loads(run('stage_machine.py', 'advance', '--project', ROOT, '--to', stage))
        if result.get('status') != 'success' or result.get('state') == 'BLOCKED':
            raise RuntimeError('Domain advance did not succeed')
    math_checks.state_pair(ROOT, stage)
    artifacts = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name != 'output.json')
    if stage == 'FREEZE':
        artifacts = sorted(set(artifacts) | {'results/manifest.sha256', 'results/reproduce.md'})
    (ROOT / 'output.json').write_text(json.dumps({'stage': stage, 'status': 'pass', 'artifacts': artifacts}), encoding='utf-8')
    if stage == 'FREEZE':
        run('freeze_artifacts.py', ROOT)
    all_files = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in p.parts and not p.name.endswith('.pyc'))
    math_checks.check(ROOT, stage, known_files=all_files)
    print(json.dumps({'status': 'pass', 'stage': stage, 'files': all_files}))


if __name__ == '__main__':
    main(sys.argv[1])
