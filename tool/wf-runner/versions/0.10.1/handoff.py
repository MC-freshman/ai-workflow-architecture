"""P8a: the neutral handoff layer (2.1.0 §3.6 / BP-4 三机制), added to the candidate engine.

Three mechanisms, one module, no new protocol operation:

* **export**  a run that stops with ``payload['x-handoff']['exportTo']`` writes a
  ``handoff-bundle/v1`` under ``config['handoffRoot']``: the finished stages exactly as the
  submit payloads recorded them (so their output/gate digests are the same objects the run
  already vouches for), a *version view* of the lock with no host paths in it, and copies of
  the artifact bytes. Written into a ``.tmp`` directory and renamed once complete, so a
  half-written bundle is not observable at that path.
* **import**  a new run prepares with ``payload['x-handoff']['bundle']``. The bundle is
  validated against the contract, every artifact digest is recomputed from the bytes in the
  bundle directory, and the version view must equal what this run resolved -- **a version
  difference is a refusal, never a silent re-pin** (BP-4 §4.5②). A differing sealed-environment
  selection is not a version change, so it is carried as an explicit warning instead.
* **arbitration** ``payload['x-arbitration-key']`` claims a key in ``config['handoffRoot']/locks``
  before the run directory exists. A live holder refuses the second run with RESOURCE_BUSY and
  the loser writes nothing at all; a claim whose run directory is gone or terminal is stale and
  may be taken over, so a crash cannot lock a project out forever.

The neutral root is a **platform config value**. Where it lives across platforms is not decided
here -- P8b registers that, because BP-4 §4.5 needs a separate authorisation for it.
"""
import hashlib
import json
import pathlib
import time


class Handoff:
    """Bundle export/import and the exclusive-key table, both rooted at config['handoffRoot']."""

    def __init__(self, root):
        self.root = pathlib.Path(str(root))

    # ---------------- paths ----------------
    def bundle_dir(self, name):
        safe = str(name).replace('\\\\', '/').strip('/')
        if not safe or '..' in pathlib.PurePosixPath(safe).parts or pathlib.PurePosixPath(safe).is_absolute():
            raise ValueError('HANDOFF_PATH_UNSAFE')
        return self.root / safe

    def lock_file(self, key):
        self.root.joinpath('locks').mkdir(parents=True, exist_ok=True)
        return self.root / 'locks' / (hashlib.sha256(str(key).encode('utf-8')).hexdigest() + '.json')

    # ---------------- integrity ----------------
    @staticmethod
    def manifest_sha(rows):
        return hashlib.sha256(json.dumps(sorted(rows, key=lambda r: r['path']), sort_keys=True,
                                         ensure_ascii=False).encode('utf-8')).hexdigest()

    # ---------------- export ----------------
    def export(self, run_root, lock, state, name):
        run_root = pathlib.Path(run_root)
        rows, stages = [], []
        for done in state['completed']:
            stage = json.loads(json.dumps(done))
            for row in list(stage['outputs']) + [g['evidence'] for g in stage['gates'] if g.get('evidence')]:
                source = run_root / row['path']
                if not source.is_file():
                    raise FileNotFoundError(str(source))
                rows.append({'path': row['path'], 'sha256': row['sha256'], 'size': row['size']})
            stages.append(stage)
        rows.sort(key=lambda r: r['path'])
        bundle = {'schema': 'handoff-bundle/v1', 'runId': lock['runId'], 'parentRunId': lock.get('parentRunId'),
                  'platform': lock['platform'], 'exportedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'lockSha256': state['lockSha256'], 'rigor': lock['execution'].get('rigor'),
                  'arbitrationKey': (state.get('x-arbitration') or {}).get('key'),
                  'versions': {'selection': {k: lock['selection'].get(k) for k in ('agent', 'workflow', 'runner')},
                               'pinned': sorted([{'key': r['key'], 'kind': r['kind'], 'id': r['id'],
                                                  'version': r['version']} for r in lock['resources']],
                                                key=lambda r: r['key'])},
                  'stages': stages, 'artifacts': rows,
                  'integrity': {'manifestSha256': self.manifest_sha(rows),
                                'canonicalization': 'sha256-cjson-safe-v1'}}
        if lock['execution'].get('execPath'):
            bundle['execPath'] = lock['execution']['execPath']
        target = self.bundle_dir(name)
        temp = target.with_name(target.name + '.tmp')
        if temp.exists():
            for stale in sorted(temp.rglob('*'), reverse=True):
                stale.unlink() if stale.is_file() else stale.rmdir()
        for row in rows:
            dest = temp / 'artifacts' / row['path']
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes((run_root / row['path']).read_bytes())
        (temp / 'bundle.json').write_bytes(json.dumps(bundle, ensure_ascii=False, indent=1).encode('utf-8') + b'\n')
        if target.exists():
            raise FileExistsError('HANDOFF_EXISTS')
        target.parent.mkdir(parents=True, exist_ok=True)
        temp.rename(target)
        return {'bundle': str(target), 'stages': len(stages), 'artifacts': len(rows),
                'manifestSha256': bundle['integrity']['manifestSha256']}

    # ---------------- import ----------------
    def read(self, name, contracts):
        directory = self.bundle_dir(name)
        manifest = directory / 'bundle.json'
        if not manifest.is_file():
            raise FileNotFoundError(str(manifest))
        bundle = json.loads(manifest.read_text(encoding='utf-8-sig'))
        contracts.validate('handoff-bundle', bundle)
        rows = []
        for row in bundle['artifacts']:
            path = directory / 'artifacts' / row['path']
            data = path.read_bytes() if path.is_file() else b''
            if hashlib.sha256(data).hexdigest() != row['sha256'] or len(data) != row['size']:
                raise ValueError('HANDOFF_ARTIFACT_MISMATCH:' + row['path'])
            rows.append(row)
        if self.manifest_sha(rows) != bundle['integrity']['manifestSha256']:
            raise ValueError('HANDOFF_MANIFEST_MISMATCH')
        return bundle, directory

    @staticmethod
    def version_view(selection, resources):
        return {'selection': {k: selection.get(k) for k in ('agent', 'workflow', 'runner')},
                'pinned': sorted([{'key': r['key'], 'kind': r['kind'], 'id': r['id'], 'version': r['version']}
                                  for r in resources], key=lambda r: r['key'])}

    def check_versions(self, bundle, view):
        """(differences, environment_delta) -- versions must match exactly; the sealed-environment
        selection is not a version, so a difference there is reported, not refused."""
        want, got = bundle['versions'], view
        problems = []
        for key in ('agent', 'workflow', 'runner'):
            if want['selection'].get(key) != got['selection'].get(key):
                problems.append('selection.%s: bundle=%s this run=%s'
                                % (key, want['selection'].get(key), got['selection'].get(key)))
        wanted = {r['key']: r['version'] for r in want['pinned']}
        have = {r['key']: r['version'] for r in got['pinned']}
        for key in sorted(set(wanted) | set(have)):
            if wanted.get(key) != have.get(key):
                problems.append('resource.%s: bundle=%s this run=%s' % (key, wanted.get(key), have.get(key)))
        delta = {'bundle': sorted(bundle.get('versions', {}).get('selection', {}).get('environment') or []),
                 'thisRun': sorted(got['selection'].get('environment') or [])}
        return problems, delta

    def seed(self, bundle, directory, run_root):
        """Copy the bundle's bytes into the new run tree and hand back the completed records."""
        run_root = pathlib.Path(run_root)
        completed = []
        for done in bundle['stages']:
            record = json.loads(json.dumps(done))
            for row in list(record['outputs']) + [g['evidence'] for g in record['gates'] if g.get('evidence')]:
                dest = run_root / row['path']
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes((directory / 'artifacts' / row['path']).read_bytes())
            completed.append(record)
        return completed

    # ---------------- arbitration ----------------
    def claim(self, key, run_id, is_terminal):
        path = self.lock_file(key)
        if path.is_file():
            try:
                holder = json.loads(path.read_text(encoding='utf-8'))
            except ValueError:
                holder = {}
            if holder.get('runId') != run_id and not is_terminal(holder.get('runId')):
                return None
        path.write_text(json.dumps({'schema': 'ai-arbitration-claim/v1', 'key': str(key),
                                    'runId': run_id, 'claimedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ',
                                                                                time.gmtime())}),
                        encoding='utf-8')
        return path

    def release(self, key, run_id):
        path = self.lock_file(key)
        if not path.is_file():
            return False
        try:
            holder = json.loads(path.read_text(encoding='utf-8'))
        except ValueError:
            holder = {}
        if holder.get('runId') != run_id:
            return False
        path.unlink()
        return True
