"""Private controlled MCP fixture; no third-party targets or real credentials."""
import json
import os
import sys
import queue
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOOLS = [
    {'name': 'sum', 'description': 'Controlled addition', 'inputSchema': {'type': 'object', 'properties': {'a': {'type': 'number'}, 'b': {'type': 'number'}}, 'required': ['a', 'b'], 'additionalProperties': False}, 'outputSchema': {'type': 'object', 'properties': {'total': {'type': 'number'}}, 'required': ['total']}, 'annotations': {'readOnlyHint': True}},
    {'name': 'write', 'description': 'Never automatically executed', 'inputSchema': {'type': 'object', 'properties': {'path': {'type': 'string'}}, 'required': ['path']}, 'annotations': {'readOnlyHint': False}}
]


def reply(request):
    method, parameters = request['method'], request.get('params') or {}
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'p15-controlled', 'version': '1.0', 'testRedaction': os.environ.get('TEST_KEY', '')}}
    elif method == 'tools/list':
        tools = json.loads(json.dumps(TOOLS))
        if os.environ.get('TOOL_DRIFT'):
            tools[0]['inputSchema']['properties']['a']['type'] = 'string'
        result = {'tools': tools[1:]} if parameters.get('cursor') == 'next' else {'tools': tools[:1], 'nextCursor': 'next'}
    elif method == 'tools/call':
        value = parameters.get('arguments') or {}
        result = {'content': [{'type': 'text', 'text': str(value['a'] + value['b'])}], 'structuredContent': {'total': value['a'] + value['b']}} if parameters['name'] == 'sum' else {'isError': True, 'content': [{'type': 'text', 'text': 'Controlled refusal'}]}
    else:
        return None
    return {'jsonrpc': '2.0', 'id': request['id'], 'result': result}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    sessions = {}

    def log_message(self, *_):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        response = reply(request)
        if self.path.startswith('/messages/'):
            if response is not None:
                self.sessions[self.path.split('/')[-1]].put(response)
            self.send_response(202)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if response is None:
            self.send_response(202)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if request['method'] != 'initialize' and self.headers.get('MCP-Protocol-Version') != '2025-11-25':
            self.send_response(400)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        encoded = json.dumps(response).encode('utf-8')
        if request['method'] == 'tools/list':
            encoded = b'data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' + b'data: ' + encoded + b'\n\n'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream' if request['method'] == 'tools/list' else 'application/json')
        self.send_header('MCP-Session-Id', 'p15-private-session')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path != '/sse':
            self.send_error(404)
            return
        key = str(uuid.uuid4())
        messages = queue.Queue()
        self.sessions[key] = messages
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        self.wfile.write(('event: endpoint\ndata: /messages/' + key + '\n\n').encode())
        self.wfile.flush()
        try:
            while True:
                response = messages.get(timeout=10)
                self.wfile.write(('data: ' + json.dumps(response) + '\n\n').encode())
                self.wfile.flush()
        except (queue.Empty, OSError):
            pass
        finally:
            self.sessions.pop(key, None)

    def do_DELETE(self):
        self.send_response(200)
        self.send_header('Content-Length', '0')
        self.end_headers()


if '--http' in sys.argv:
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    print(json.dumps({'port': server.server_port}), flush=True)
    server.serve_forever()
else:
    for line in sys.stdin:
        result = reply(json.loads(line))
        if result:
            print(json.dumps(result, ensure_ascii=False), flush=True)
