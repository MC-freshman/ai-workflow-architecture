"""Read-only Phase 1 domain gate dispatch; generic M3-B gates are separate."""
from pathlib import Path

from runtime_core import Rejected, load_module, relative_path, verify_files


def validate_evidence(contracts, run_root, payload, gate, declaration):
    prefix = f"evidence/{payload['stageId']}/{payload['attempt']}/"
    root = relative_path(run_root, prefix.rstrip('/'))
    # This validator is runner-owned code, never imported from submitted output.
    check_path = Path(__file__).with_name('math_checks.py')
    if not check_path.exists():
        check_path = Path(__file__).parent.parent / 'math-modeling/math_checks.py'
    checker = load_module(check_path, 'pinned_math_checks')
    known = [o['path'][len(prefix):] for o in payload['outputs']]
    try:
        decisions = checker.check(root, payload['stageId'], known_files=known)
        if decisions.get(declaration['check']) != 'pass':
            raise ValueError('Required domain decision is absent')
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise Rejected('GATE_FAILED', 'Domain acceptance failed: ' + str(exc)) from exc
