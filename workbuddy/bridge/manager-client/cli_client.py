"""A JSON CLI client with an actual MCP stdio connection. It never directly runs the engine."""
import json
from pathlib import Path
import subprocess
import sys


def main():
    arguments = json.load(sys.stdin)
    tool = arguments.get('tool', 'architecture_probe')
    tool_arguments = arguments.get('arguments', arguments) if 'tool' in arguments else arguments
    adapter = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    server = adapter['server']
    child = subprocess.Popen([server['executable']] + server['args'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        requests = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'architecture-json-cli-client', 'version': '0.4.0'}}}, {'jsonrpc': '2.0', 'method': 'notifications/initialized'}, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': tool, 'arguments': tool_arguments}}]
        stdout, _ = child.communicate('\n'.join(json.dumps(r) for r in requests) + '\n', timeout=600 if tool == 'architecture_run' else 20)
        replies = [json.loads(line) for line in stdout.splitlines() if line.strip()]
        initialize = next(r for r in replies if r.get('id') == 1)
        tools = next(r for r in replies if r.get('id') == 2)
        probe = next(r for r in replies if r.get('id') == 3)
        if child.returncode != 0 or 'error' in initialize or tool not in [t['name'] for t in tools['result']['tools']] or probe.get('error'):
            raise ValueError('MCP connection failed')
        value = json.loads(probe['result']['content'][0]['text'])
        if tool == 'architecture_probe':
            value['client'] = 'architecture-json-cli-client'
            value['transport'] = 'mcp-stdio'
            value['nativeVendorClientVerified'] = False
        print(json.dumps(value))
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()


if __name__ == '__main__':
    main()
