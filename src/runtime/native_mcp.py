"""Bounded native MCP metadata/call client. No platform paths or credential values are recorded."""
import json
import os
import queue
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SUPPORTED = ('2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25')
LIMIT = 8 * 1024 * 1024


class McpFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, target):
        raise McpFailure('EGRESS_DENIED')


class NativeMcpClient:
    def __init__(self, spec):
        self.spec = spec
        self.child = None
        self.stream = None
        self.session = None
        self.kind = spec['kind']
        self.version = spec.get('protocolVersion', '2025-11-25')
        if self.version not in SUPPORTED:
            raise McpFailure('MCP_PROTOCOL_UNSUPPORTED')
        self.deadline = time.monotonic() + min(120, max(1, int(spec.get('timeoutSeconds', 30))))
        self.counter = 0
        self.endpoint = spec.get('endpoint')
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}))
        if self.kind == 'stdio':
            self.messages = queue.Queue(maxsize=16)
            inherited = {name: value for name, value in os.environ.items() if not re.search('TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API.?KEY', name, re.I)}
            self.child = subprocess.Popen([spec['command']] + spec.get('args', []), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=spec.get('cwd'), env=dict(inherited, **spec.get('env', {})))
            threading.Thread(target=self._read_stdout, daemon=True).start()
            threading.Thread(target=self._drain_stderr, daemon=True).start()
        elif self.kind in ('sse', 'streamable-http'):
            self._check_url(self.endpoint)
            if self.kind == 'sse':
                self.stream = self.opener.open(urllib.request.Request(self.endpoint, headers=dict(spec.get('headers', {}), Accept='text/event-stream')), timeout=self.remaining())
                event, data = self._event(self.stream)
                if event != 'endpoint' or not isinstance(data, str):
                    raise McpFailure('MCP_PROTOCOL_INVALID')
                self.post_endpoint = urllib.parse.urljoin(self.endpoint.rstrip('/') + '/', data)
                self._check_url(self.post_endpoint)
                if self._origin(self.post_endpoint) != self._origin(self.endpoint):
                    raise McpFailure('EGRESS_DENIED')
        else:
            raise McpFailure('MCP_TRANSPORT_UNSUPPORTED')

    @staticmethod
    def _check_url(url):
        value = urllib.parse.urlparse(str(url))
        if value.scheme not in ('http', 'https') or not value.hostname or value.username or value.password:
            raise McpFailure('MCP_ENDPOINT_INVALID')

    @staticmethod
    def _origin(url):
        value = urllib.parse.urlparse(url)
        return value.scheme, value.hostname, value.port or (443 if value.scheme == 'https' else 80)

    def remaining(self):
        value = self.deadline - time.monotonic()
        if value <= 0:
            raise McpFailure('SOFTWARE_TIMEOUT')
        return max(.1, value)

    def _read_stdout(self):
        try:
            while True:
                raw = self.child.stdout.readline(LIMIT + 1)
                if not raw:
                    break
                if len(raw) > LIMIT:
                    raise McpFailure('MCP_RESPONSE_TOO_LARGE')
                self.messages.put(json.loads(raw.decode('utf-8')))
        except Exception:
            self.messages.put(McpFailure('MCP_PROTOCOL_INVALID'))
        finally:
            self.messages.put(McpFailure('GATEWAY_UNREACHABLE'))

    def _drain_stderr(self):
        # A native server's logs are untrusted and may contain credentials.
        while self.child.stderr.read(4096):
            pass

    def _event(self, stream):
        data, event, size = [], 'message', 0
        while True:
            self.remaining()
            raw = stream.readline(LIMIT + 1)
            size += len(raw)
            if not raw:
                raise McpFailure('GATEWAY_UNREACHABLE')
            if size > LIMIT:
                raise McpFailure('MCP_RESPONSE_TOO_LARGE')
            line = raw.decode('utf-8').rstrip('\r\n')
            if line.startswith('event:'):
                event = line[6:].strip()
            elif line.startswith('data:'):
                data.append(line[5:].lstrip())
            elif line == '' and data:
                text = '\n'.join(data)
                return event, text if event == 'endpoint' else json.loads(text)

    def _http(self, payload, notify=False):
        headers = dict(self.spec.get('headers', {}))
        headers.update({'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        if self.session:
            headers['MCP-Session-Id'] = self.session
        headers['MCP-Protocol-Version'] = self.version
        url = self.post_endpoint if self.kind == 'sse' else self.endpoint
        request = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers=headers, method='POST')
        with self.opener.open(request, timeout=self.remaining()) as response:
            if self.kind == 'sse':
                response.read(LIMIT + 1)
                if notify:
                    return None
            else:
                session = response.headers.get('MCP-Session-Id')
                if session:
                    if not all(0x21 <= ord(char) <= 0x7e for char in session):
                        raise McpFailure('MCP_PROTOCOL_INVALID')
                    self.session = session
                if notify:
                    if response.status != 202:
                        raise McpFailure('MCP_PROTOCOL_INVALID')
                    return None
                if response.headers.get('Content-Type', '').split(';')[0].strip() == 'text/event-stream':
                    while True:
                        _, result = self._event(response)
                        if result.get('id') == payload['id']:
                            return result
                raw = response.read(LIMIT + 1)
                if len(raw) > LIMIT:
                    raise McpFailure('MCP_RESPONSE_TOO_LARGE')
                return json.loads(raw.decode('utf-8'))
        while True:
            _, result = self._event(self.stream)
            if result.get('id') == payload['id']:
                return result

    def notify(self, method, params=None):
        payload = {'jsonrpc': '2.0', 'method': method, 'params': params or {}}
        if self.kind == 'stdio':
            self.child.stdin.write((json.dumps(payload) + '\n').encode('utf-8'))
            self.child.stdin.flush()
        else:
            self._http(payload, notify=True)

    def request(self, method, params=None):
        self.counter += 1
        payload = {'jsonrpc': '2.0', 'id': self.counter, 'method': method, 'params': params or {}}
        if self.kind == 'stdio':
            self.child.stdin.write((json.dumps(payload, ensure_ascii=False) + '\n').encode('utf-8'))
            self.child.stdin.flush()
            while True:
                try:
                    response = self.messages.get(timeout=self.remaining())
                except queue.Empty:
                    raise McpFailure('SOFTWARE_TIMEOUT')
                if isinstance(response, Exception):
                    raise response
                if response.get('id') == self.counter:
                    break
                if response.get('method') and response.get('id') is not None:
                    self.child.stdin.write((json.dumps({'jsonrpc': '2.0', 'id': response['id'], 'error': {'code': -32601, 'message': 'Client capability not declared'}}) + '\n').encode('utf-8'))
                    self.child.stdin.flush()
        else:
            response = self._http(payload)
        if not isinstance(response, dict) or response.get('id') != self.counter or response.get('jsonrpc') != '2.0' or 'result' not in response:
            raise McpFailure('MCP_REQUEST_FAILED')
        return response['result']

    def initialize(self):
        result = self.request('initialize', {'protocolVersion': self.version, 'capabilities': {}, 'clientInfo': {'name': 'architecture-manager-native', 'version': '0.5.0'}})
        negotiated = result.get('protocolVersion')
        if negotiated not in SUPPORTED:
            raise McpFailure('MCP_PROTOCOL_UNSUPPORTED')
        self.version = negotiated
        self.notify('notifications/initialized')
        return result

    def tools(self):
        tools, cursors, cursor = [], set(), None
        for _ in range(100):
            result = self.request('tools/list', {'cursor': cursor} if cursor else {})
            if not isinstance(result.get('tools'), list):
                raise McpFailure('MCP_PROTOCOL_INVALID')
            tools.extend(result['tools'])
            if len(tools) > 10000:
                raise McpFailure('MCP_RESPONSE_TOO_LARGE')
            cursor = result.get('nextCursor')
            if not cursor:
                return tools
            if not isinstance(cursor, str) or cursor in cursors:
                raise McpFailure('MCP_PAGINATION_INVALID')
            cursors.add(cursor)
        raise McpFailure('MCP_PAGINATION_INVALID')

    def close(self):
        if self.stream:
            self.stream.close()
        if self.child:
            self.child.terminate()
            try:
                self.child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait(timeout=3)
        if self.session and self.kind == 'streamable-http':
            try:
                headers = dict(self.spec.get('headers', {}), **{'MCP-Session-Id': self.session, 'MCP-Protocol-Version': self.version})
                self.opener.open(urllib.request.Request(self.endpoint, headers=headers, method='DELETE'), timeout=2).close()
            except Exception:
                pass


def exchange(spec, method='tools/list', params=None):
    client = None
    try:
        client = NativeMcpClient.__new__(NativeMcpClient)
        NativeMcpClient.__init__(client, spec)
        initialized = client.initialize()
        result = {'tools': client.tools()} if method == 'tools/list' else client.request(method, params)
        if method == 'tools/call' and (not isinstance(result, dict) or result.get('isError')):
            raise McpFailure('MCP_TOOL_FAILED')
        return {'result': result, 'serverInfo': initialized.get('serverInfo', {}), 'protocolVersion': client.version}
    except McpFailure:
        raise
    except (TimeoutError, queue.Empty):
        raise McpFailure('SOFTWARE_TIMEOUT')
    except urllib.error.HTTPError as error:
        raise McpFailure('MCP_AUTH_REQUIRED' if error.code in (401, 403) else 'MCP_REQUEST_FAILED')
    except (OSError, urllib.error.URLError):
        raise McpFailure('GATEWAY_UNREACHABLE')
    except (ValueError, KeyError, TypeError):
        raise McpFailure('MCP_PROTOCOL_INVALID')
    finally:
        if client:
            client.close()
