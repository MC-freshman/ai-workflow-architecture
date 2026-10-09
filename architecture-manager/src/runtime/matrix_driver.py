"""Use the frozen shared matrix with schema-valid maintenance inputs. No business stage is run."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


script = Path(sys.argv[1]); arguments = sys.argv[2:]
specification = importlib.util.spec_from_file_location('manager_shared_matrix', script)
matrix = importlib.util.module_from_spec(specification); specification.loader.exec_module(matrix)
original = matrix.parameters_for
bindings = []


def parameters(tool_root, release, manifest):
    value = original(tool_root, release, manifest)
    schema = json.loads((release / manifest['inputSchema']).read_text(encoding='utf-8-sig'))
    # This permission profile defines read-only shared roots and a platform report; its live input
    # belongs to the selected platform backend. The old synthesizer ignores conditional constants.
    if manifest.get('permissions', {}).get('filesystem') == 'shared-read-only-platform-report-write' and {'scope', 'toolRoot', 'agentRoot', 'report'} <= set(schema.get('properties', {})):
        value.update({'scope': 'live', 'toolRoot': '/shared/tool', 'agentRoot': '/shared/agent', 'report': '/work/reports/onboarding.json'})
        import jsonschema
        jsonschema.Draft202012Validator(schema).validate(value)
        bindings.append({'id': manifest['id'], 'version': manifest['version'], 'schemaSha256': hashlib.sha256((release / manifest['inputSchema']).read_bytes()).hexdigest(), 'inputSha256': hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest(), 'profile': 'shared-read-only-platform-report-write', 'valid': True})
    return value


matrix.parameters_for = parameters
sys.argv = [str(script)] + arguments
status = matrix.main()
if '--out' in arguments:
    output = Path(arguments[arguments.index('--out') + 1])
    report = json.loads(output.read_text(encoding='utf-8'))
    report['managerDriver'] = {'sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'sharedHarnessSha256': hashlib.sha256(script.read_bytes()).hexdigest(), 'inputBindings': bindings, 'businessStagesExecuted': False}
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
sys.exit(status)
