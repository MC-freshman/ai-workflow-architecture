"""Independent read-only acceptance of modeling outputs and legacy QA evidence."""
import hashlib
import json
import math
from pathlib import Path

import yaml

STAGES = ['INIT', 'AUDIT', 'SPEC', 'BASELINE', 'SOLVE', 'EXPERIMENT', 'VALIDATE', 'FIGURES', 'FREEZE']
FIGURE_GATES = ['figure_contract', 'source_preflight', 'render_preview', 'layout_bbox_qa', 'composition_efficiency', 'panel_alignment', 'pdf_collision', 'visual_review']
VISUAL_CHECKS = {'glyphs', 'clipping', 'legend_data_occlusion', 'annotation_overlap', 'panel_alignment', 'color_grayscale', 'data_extent'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def path(root, relative):
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute() and '\\' not in relative and ':' not in relative and '..' not in relative.split('/'), 'Unsafe domain artifact path')
    target = root / relative
    for item in [target] + list(target.parents):
        if item == root.parent:
            break
        require(not item.is_symlink() and not (getattr(item.lstat(), 'st_file_attributes', 0) & 0x400) if item.exists() else True, 'Linked domain artifact')
    target.resolve().relative_to(root.resolve())
    return target


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read(root, name):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(path(root, name).read_text(encoding='utf-8'), object_pairs_hook=unique)


def state_pair(root, expected=None):
    manifest, state = read(root, 'project_manifest.json'), read(root, 'stage_state.json')
    require(manifest['current_stage'] == state['stage'], 'Domain state files disagree')
    require(manifest['project_id'] == state['project_id'], 'Domain project identity differs')
    require(state['status'] == 'READY', 'Domain status is not READY')
    if expected:
        require(state['stage'] == expected, 'Unexpected domain stage')
    return state


def specification(root):
    spec = yaml.safe_load(path(root, 'model_spec.yaml').read_text(encoding='utf-8'))
    require(spec.get('status') == 'CONFIRMED' and spec.get('confirmation', {}).get('by') and spec['confirmation'].get('basis'), 'Model specification lacks traceable confirmation')
    require(spec.get('units') and spec.get('objective') and spec.get('expected'), 'Model specification is incomplete')
    tolerance = float(spec['tolerance'])
    require(math.isfinite(tolerance) and tolerance >= 0, 'Invalid numerical tolerance')
    require(all(math.isfinite(float(value)) for value in spec['expected'].values()), 'Expected metrics must be finite')
    return spec


def figures(root, config):
    contract = read(root, config['figureContract'])
    qa_path = config['qaDirectory'] + '/figure_qa.json'
    qa = read(root, qa_path)
    review = read(root, config['visualReview'])
    require(contract.get('figure_id') and contract.get('claim') and contract.get('entrypoint') == config['figureSource'], 'Figure contract is incomplete')
    require(qa.get('status') == 'PASS' and qa.get('figure_id') == contract['figure_id'], 'Figure QA failed or identity differs')
    require(qa.get('source') == config['figureSource'] and qa.get('contract') == config['figureContract'], 'QA uses different source or contract')
    require(qa['source_sha256'] == sha(path(root, qa['source'])) and qa['contract_sha256'] == sha(path(root, qa['contract'])), 'Stale QA source or contract')
    stages = qa['stages']
    require(stages['SOURCE_PREFLIGHT']['summary']['ready'] is True, 'Source preflight failed')
    require(stages['RENDER_PREVIEW']['status'] == 'PASS', 'Preview was not rendered')
    require(stages['LAYOUT_QA']['status'] == 'PASS', 'Layout bbox QA failed')
    require(stages['COMPOSITION_EFFICIENCY']['status'] == 'PASS', 'Composition efficiency failed')
    require(stages['LAYOUT_QA']['alignment'] == 'PASS', 'Panel alignment unavailable or failed')
    geometry = stages['PDF_GEOMETRY_QA']
    require(geometry['status'] == 'PASS' and geometry['collision'] == 'PASS' and geometry['pdf_text'] == 'PASS', 'PDF geometry or text QA failed')
    artifacts = qa['artifacts']
    for kind in ('preview', 'pdf', 'svg', 'png', 'composition', 'collision', 'collision_overlay', 'pdf_text'):
        require(artifacts[kind + '_sha256'] == sha(path(root, artifacts[kind])), 'Stale QA artifact: ' + kind)
    alignment = read(root, artifacts['alignment'])
    require(alignment['verdict'] == 'PASS' and alignment['summary']['fail'] == 0 and alignment['summary']['warn'] == 0, 'Panel alignment report failed')
    require(review.get('schema') == 'ai-visual-review/v1' and review.get('decision') == 'PASS', 'Visual review missing or rejected')
    require(review.get('reviewer_type') in ('human', 'multimodal-agent') and review.get('reviewer') and review.get('observations'), 'Visual reviewer and observations required')
    require(set(review.get('checks', {})) == VISUAL_CHECKS and all(v == 'PASS' for v in review['checks'].values()), 'Visual review check missing')
    require(review['qa_report'] == qa_path and review['qa_report_sha256'] == sha(path(root, qa_path)), 'Stale visual QA report')
    require(review['preview'] == artifacts['preview'] and review['preview_sha256'] == artifacts['preview_sha256'], 'Stale visual preview')
    require(review['source_sha256'] == qa['source_sha256'] and review['contract_sha256'] == qa['contract_sha256'], 'Stale visual source or contract')
    check = read(root, 'reports/figure_check.json')
    require(check.get('status') == 'success' and check.get('figures') and not check.get('errors'), 'Registered figure check failed')
    return {gate: 'pass' for gate in FIGURE_GATES}


def check(root, stage, known_files=None, before_advance=False):
    root = Path(root)
    state_pair(root, STAGES[STAGES.index(stage) - 1] if before_advance and stage != 'INIT' else stage)
    config = read(root, 'phase1.json')
    index = STAGES.index(stage)
    if index >= 1:
        audit = read(root, 'reports/' + Path(config['dataFile']).stem + '_audit.json')
        require(audit['rows'] > 0 and path(root, 'reports/' + Path(config['dataFile']).stem + '_audit.md').is_file(), 'Data audit missing or empty')
    if index >= 2:
        spec = specification(root)
    if index >= 3:
        require(path(root, config['baselineEntry']).is_file(), 'Baseline source missing')
        baseline = read(root, 'results/baseline.json')
        require(baseline.get('status') == 'pass' and math.isfinite(float(baseline[config.get('baselineMetric', 'mse')])), 'Baseline metrics invalid')
    if index >= 4:
        require(path(root, config['solverEntry']).is_file(), 'Solver source missing')
        result = read(root, 'results/solution.json')
        require(result.get('status') == 'pass', 'Solver result failed')
        for name, expected in spec['expected'].items():
            actual = float(result[name])
            require(math.isfinite(actual) and abs(actual - float(expected)) <= float(spec['tolerance']), 'Numerical constraint failed: ' + name)
    if index >= 5:
        runs = read(root, 'experiments/last_run.json')
        require(runs.get('status') == 'success' and runs.get('runs') and all(r.get('status') == 'PASS' for r in runs['runs']), 'Experiment absent, skipped or failed')
        for run in runs['runs']:
            require(run['entrypoint_hash'] == sha(path(root, run['entrypoint'])), 'Stale experiment source')
            for name, digest in run['input_hashes'].items():
                require(sha(path(root, name)) == digest, 'Stale experiment input')
    if index >= 6:
        report = read(root, 'reports/validation.json')
        require(report.get('status') == 'PASS' and report.get('checks') and all(c['status'] == 'PASS' for c in report['checks']), 'Business validation failed')
        require(path(root, 'reports/validation_report.md').is_file(), 'Validation summary absent')
        independent = read(root, 'reports/independent-validation.json')
        require(independent.get('status') == 'PASS' and len(independent.get('checks', {})) >= 3 and all(independent['checks'].values()), 'Independent model checks absent or failed')
    gates = {'domain': 'pass'}
    if index >= 7:
        gates.update(figures(root, config))
    if stage == 'FREEZE' and not before_advance:
        frozen = read(root, 'results/manifest.sha256')
        require(frozen.get('manifest_version') == '1.0' and frozen.get('root') == '.', 'Freeze is not the domain JSON manifest')
        entries = frozen['files']
        names = [item['path'] for item in entries]
        require(names and len({n.casefold() for n in names}) == len(names), 'Empty or aliased freeze entries')
        required = {'project_manifest.json', 'stage_state.json', 'model_spec.yaml', 'results/result_registry.csv', 'figures/figure_registry.csv', 'reports/validation_report.md', 'reports/figure_check.json'}
        require(required.issubset(names), 'Required frozen artifacts missing')
        for entry in entries:
            require(sha(path(root, entry['path'])) == entry['sha256'], 'Frozen hash mismatch: ' + entry['path'])
        if known_files is not None:
            expected_files = {n for n in known_files if n != 'results/manifest.sha256' and '__pycache__' not in n.split('/') and not n.endswith('.pyc')}
            require(set(names) == expected_files, 'Freeze coverage differs from final output')
    return gates
