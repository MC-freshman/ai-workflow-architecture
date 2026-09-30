"""Reference software gateway (architecture 3.0, S-P4).

One JSON object in on stdin, one JSON object out on stdout - the same dispatch shape the runner already
uses for a script stage or a peer delegation. The engine never speaks MCP, never holds a software
process, and never reads a body: it asks this gateway, which resolves the recipe from the shared
registry, refuses anything the frozen capability snapshot cannot back, and answers with the contract in
runtime-contracts 1.3.0's `software-gateway-adapter/v1`.

Concurrency is decided here because instances are platform state: `per-run` claims nothing, `pooled`
counts slots up to `poolSize`, `singleton` holds one slot for the whole platform, and every
`exclusiveResources` key is a mutual-exclusion lock under `lockRoot`. A loser writes nothing at all -
no evidence file, no body side effect.
"""
import argparse
import hashlib
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ADAPTER_SCHEMA = 'ai-software-call/v1'
INVENTORY_SCHEMA = 'ai-software-inventory/v1'
INSTANCE_SCHEMA = 'ai-software-instance/v1'
BUSY = 'SOFTWARE_BUSY'


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


class Reply(Exception):
    """A structured refusal: every one of them names the key or field that caused it (C-4/D-27)."""

    def __init__(self, code, message, named=None, retryable=False):
        Exception.__init__(self, message)
        self.code, self.message, self.named, self.retryable = code, message, named or {}, retryable


class Gateway:
    def __init__(self, config):
        self.config = config
        self.root = pathlib.Path(config['softwareRoot'])
        self.lock_root = pathlib.Path(config['lockRoot'])
        self.evidence_root = pathlib.Path(config['evidenceRoot'])
        self.bodies = {k: pathlib.Path(v) for k, v in (config.get('bodies') or {}).items()}

    # ---------- resolution ----------
    def registry(self):
        path = self.root / 'registry.json'
        if not path.is_file():
            raise Reply('CAPABILITY_UNAVAILABLE', 'the software registry is missing', {'key': 'softwareRoot'})
        return json.loads(path.read_text(encoding='utf-8-sig'))

    def release(self, software_id, version):
        entry = next((e for e in self.registry().get('software') or [] if e.get('id') == software_id), None)
        if entry is None:
            raise Reply('CAPABILITY_UNAVAILABLE', 'no such recipe in the registry',
                        {'registry': 'software/registry.json', 'softwareId': software_id})
        pointer = json.loads((self.root / entry['current']).read_text(encoding='utf-8-sig'))
        if version != pointer.get('version'):
            raise Reply('SOFTWARE_NOT_INSTALLED', 'the gateway only serves the pinned release of a recipe',
                        {'softwareId': software_id, 'asked': version, 'pinned': pointer.get('version')})
        directory = self.root / software_id / 'versions' / str(pointer['version'])
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8-sig'))
        snapshot_path = directory / manifest['snapshot']
        snapshot = json.loads(snapshot_path.read_text(encoding='utf-8-sig'))
        return directory, manifest, snapshot

    # ---------- locks: the platform-internal table ----------
    def lock_file(self, key):
        return self.lock_root / (hashlib.sha256(key.encode('utf-8')).hexdigest() + '.json')

    def claim(self, key, holder, exclusive):
        self.lock_root.mkdir(parents=True, exist_ok=True)
        path = self.lock_file(key)
        record = {'key': key, 'holder': holder, 'exclusive': exclusive, 'claimedAt': now()}
        try:
            with path.open('x', encoding='utf-8') as stream:
                json.dump(record, stream, ensure_ascii=False)
            return True
        except FileExistsError:
            try:
                current = json.loads(path.read_text(encoding='utf-8'))
            except ValueError:
                current = {}
            if not current.get('holder') or path.stat().st_mtime < time.time() - 3600:
                path.write_text(json.dumps(record, ensure_ascii=False), encoding='utf-8')
                return True
            return False

    def release_lock(self, key, holder):
        path = self.lock_file(key)
        if path.is_file():
            try:
                if json.loads(path.read_text(encoding='utf-8')).get('holder') == holder:
                    path.unlink()
            except ValueError:
                path.unlink(missing_ok=True)

    def instance_state(self, software_id, version):
        _, manifest, _ = self.release(software_id, version)
        concurrency = manifest['concurrency']
        keys = [software_id + ':' + str(concurrency['instanceMode'])] + \
               [software_id + ':' + r for r in concurrency.get('exclusiveResources') or []]
        return {'instanceMode': concurrency['instanceMode'], 'poolSize': concurrency.get('poolSize'),
                'whenBusy': concurrency['whenBusy'], 'exclusiveResources': keys,
                'holders': sorted(p.parent.name + '/' + p.name for p in self.lock_root.glob('*.json'))}

    # ---------- adapters ----------
    def live_capabilities(self, manifest):
        """What the body reports right now, against the frozen snapshot. Each transport has a real
        question to ask; the gateway never answers on the manifest's behalf, because that would make
        drift undetectable by construction."""
        body = self.bodies.get(manifest['id'])
        interpreter = (self.config.get('interpreters') or {}).get(body.suffix.lower()) if body else None
        if body is None or not body.is_file():
            raise Reply('SOFTWARE_NOT_INSTALLED', 'no installed body to ask for its capability list',
                        {'configKey': 'bodies.%s' % manifest['id']})
        if manifest['kind'] in ('cli-wrapper', 'mcp-stdio'):
            if interpreter is None:
                raise Reply('CAPABILITY_UNAVAILABLE', 'the platform config declares no interpreter for '
                            'this body type, so the gateway will not guess one',
                            {'configKey': 'interpreters.%s' % body.suffix.lower()})
            proc = subprocess.run([interpreter, str(body), '--tools'], capture_output=True, timeout=60)
            payload = json.loads(proc.stdout.decode('utf-8', 'replace').strip().splitlines()[-1])
        else:
            payload = self.post(manifest['transport']['baseUrl'], {'method': 'tools/list'})
        if 'tools' not in payload:
            raise Reply('CAPABILITY_UNAVAILABLE', 'the body answered without a capability list',
                        {'softwareId': manifest['id']})
        return list(payload['tools'])

    def post(self, url, body):
        request = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                         headers={'content-type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode('utf-8'))

    def call(self, message):
        software_id, version = message['softwareId'], message['softwareVersion']
        directory, manifest, snapshot = self.release(software_id, version)
        capability = next((c for c in manifest['capabilities'] if c['name'] == message['capability']), None)
        if capability is None:
            raise Reply('CAPABILITY_UNAVAILABLE', 'the recipe does not declare that capability',
                        {'softwareId': software_id, 'capability': message['capability']})
        if not snapshot.get('frozen'):
            # C-4: no frozen baseline means no comparison is possible. Say so; do not call it drift.
            raise Reply('CAPABILITY_UNAVAILABLE', 'the capability snapshot is not frozen, so the gateway '
                        'cannot verify the live capability list against it',
                        {'softwareId': software_id, 'field': 'capabilities.snapshot.json#frozen'})
        frozen = sorted(c['name'] for c in snapshot['capabilities'])
        live = sorted(self.live_capabilities(manifest))
        if live != frozen:
            raise Reply('SOFTWARE_DRIFT', 'the live capability list differs from the frozen snapshot',
                        {'softwareId': software_id, 'added': [n for n in live if n not in frozen],
                         'removed': [n for n in frozen if n not in live]})
        if capability.get('consent') in ('confirm-stage', 'confirm-call') and not message.get('consented'):
            raise Reply('CONSENT_REQUIRED', 'this capability needs confirmation for this call',
                        {'softwareId': software_id, 'capability': capability['name'],
                         'consent': capability['consent']})
        return self.dispatch(message, manifest, capability, directory)

    def dispatch(self, message, manifest, capability, directory):
        concurrency = manifest['concurrency']
        holder = message.get('runId') or 'adhoc'
        keys = []
        if concurrency['instanceMode'] == 'singleton':
            keys.append(manifest['id'] + ':singleton')
        elif concurrency['instanceMode'] == 'pooled':
            slot = int(digest(holder), 16) % max(1, int(concurrency['poolSize'] or 1))
            keys.append(manifest['id'] + ':pooled:%d' % slot)
        keys += [manifest['id'] + ':' + r for r in concurrency.get('exclusiveResources') or []]
        claimed = []
        try:
            for key in keys:
                if not self.claim(key, holder, key in keys):
                    raise Reply(BUSY if concurrency['whenBusy'] == 'reject-retryable' else 'SOFTWARE_BUSY',
                                'another holder owns %s; nothing was dispatched' % key,
                                {'key': key, 'mode': concurrency['instanceMode']}, retryable=True)
                claimed.append(key)
            return self.invoke(message, manifest, capability, directory, concurrency)
        finally:
            for key in claimed:
                self.release_lock(key, holder)

    def invoke(self, message, manifest, capability, directory, concurrency):
        invocation = capability['invocation']
        body = self.bodies.get(manifest['id'])
        if body is None or not body.is_file():
            raise Reply('SOFTWARE_NOT_INSTALLED', 'this platform has no installed body for the recipe',
                        {'configKey': 'bodies.%s' % manifest['id'],
                         'expectedPath': str(self.config.get('bodies', {}).get(manifest['id'], ''))})
        if body.suffix.lower() not in ('.exe', '.cmd', '.bat', ''):
            interpreter = (self.config.get('interpreters') or {}).get(body.suffix.lower())
            if interpreter is None:
                raise Reply('CAPABILITY_UNAVAILABLE', 'the platform config declares no interpreter for '
                            'this body type and the gateway will not guess one',
                            {'configKey': 'interpreters.%s' % body.suffix.lower()})
        prefix = [self.config['interpreters'][body.suffix.lower()]] if body.suffix.lower() in (
            self.config.get('interpreters') or {}) else []
        arguments = message.get('arguments') or {}
        if manifest['kind'] == 'cli-wrapper':
            argv = prefix + [str(body)] + list(invocation.get('baseArgv') or [])
            for spec in invocation.get('argMapping') or []:
                value = arguments.get(spec['param'])
                if value is None:
                    continue
                argv.append('%s%s' % (spec.get('flag', ''), value) if spec.get('style') != 'positional' else str(value))
            proc = subprocess.run(argv, capture_output=True, timeout=int(invocation.get('timeout') or 300))
            payload = {'stdout': proc.stdout.decode('utf-8', 'replace'), 'exitCode': proc.returncode}
        elif manifest['kind'] == 'mcp-stdio':
            proc = subprocess.run([prefix[0], str(body), json.dumps({'capability': capability['name'],
                                                          'arguments': arguments}, ensure_ascii=False)],
                                  capture_output=True, timeout=int(invocation.get('timeout') or 300))
            payload = json.loads(proc.stdout.decode('utf-8', 'replace').strip().splitlines()[-1])
        else:
            payload = self.post(invocation['endpoint'], {'capability': capability['name'],
                                                         'arguments': arguments})
        sequence = len(list(self.evidence_root.glob('*'))) + 1
        call_root = self.evidence_root / str(sequence)
        call_root.mkdir(parents=True, exist_ok=True)
        request_path = call_root / 'request.json'
        request_path.write_bytes(json.dumps({'schema': ADAPTER_SCHEMA, 'kind': 'request',
                                             'softwareId': manifest['id'],
                                             'softwareVersion': manifest['version'],
                                             'capability': capability['name'], 'arguments': arguments,
                                             'idempotencyKey': message['idempotencyKey'],
                                             'at': now()}, ensure_ascii=False).encode('utf-8') + b'\n')
        (call_root / 'response.json').write_bytes(json.dumps({'schema': ADAPTER_SCHEMA, 'kind': 'response',
                                                              'ok': True,
                                                              'result': {'outputSha256': digest(payload),
                                                                         'exitCode': payload.get('exitCode', 0),
                                                                         'instanceMode': concurrency['instanceMode'],
                                                                         'output': payload}},
                                                             ensure_ascii=False).encode('utf-8') + b'\n')
        return {'outputSha256': digest(payload), 'exitCode': payload.get('exitCode', 0),
                'instanceMode': concurrency['instanceMode'], 'output': payload,
                'evidencePath': 'evidence/software-calls/%d/request.json' % sequence,
                'requestSha256': hashlib.sha256(request_path.read_bytes()).hexdigest()}

    # ---------- messages ----------
    def handle(self, message):
        kind = message.get('schema')
        try:
            if kind == ADAPTER_SCHEMA:
                return {'schema': ADAPTER_SCHEMA, 'kind': 'response', 'ok': True,
                        'result': self.call(message)}
            if kind == INSTANCE_SCHEMA:
                state = self.instance_state(message['softwareId'], message['softwareVersion'])
                return {'schema': INSTANCE_SCHEMA, 'kind': 'response', 'ok': True,
                        'state': 'claimed' if state['holders'] else 'idle', 'holder': message.get('holder'),
                        'instanceMode': state['instanceMode'], 'exclusiveResources': state['exclusiveResources'],
                        'holders': state['holders']}
            if kind == INVENTORY_SCHEMA:
                _, manifest, snapshot = self.release(message['softwareId'], message['softwareVersion'])
                return {'schema': INVENTORY_SCHEMA, 'kind': 'response', 'ok': True,
                        'softwareId': manifest['id'], 'installedVersion': manifest['version'],
                        'frozen': bool(snapshot.get('frozen')),
                        'capabilities': snapshot['capabilities']}
            raise Reply('INVALID_REQUEST', 'unknown gateway request schema', {'schema': kind})
        except Reply as refusal:
            return {'schema': kind or ADAPTER_SCHEMA, 'kind': 'response', 'ok': False,
                    'error': {'code': refusal.code, 'message': refusal.message,
                              'retryable': refusal.retryable, 'named': refusal.named}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--config', required=True)
    parser.add_argument('--request', help='a file holding one gateway message; stdin otherwise')
    parser.add_argument('--listen', help='serve one HTTP request per line on host:port (mcp-http mock)')
    args = parser.parse_args(argv)
    gateway = Gateway(json.loads(pathlib.Path(args.config).read_text(encoding='utf-8-sig')))
    if args.listen:
        host, port = args.listen.rsplit(':', 1)
        server = socket.socket()
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((host, int(port)))
        server.listen(8)
        print(json.dumps({'listening': args.listen, 'pid': os.getpid()}), flush=True)
        while True:
            connection, _ = server.accept()
            data = b''
            while b'\r\n\r\n' not in data:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                data += chunk
            body = data.split(b'\r\n\r\n', 1)[-1].decode('utf-8')
            answer = json.dumps(gateway.handle(json.loads(body) if body.strip() else {}), ensure_ascii=False)
            connection.sendall(('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: %d\r\n'
                                'connection: close\r\n\r\n%s' % (len(answer.encode('utf-8')), answer)).encode('utf-8'))
            connection.close()
        return 0
    raw = pathlib.Path(args.request).read_text(encoding='utf-8') if args.request else sys.stdin.read()
    print(json.dumps(gateway.handle(json.loads(raw)), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
