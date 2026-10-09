"""Metadata-only discovery. Values from native credential providers stay in memory."""
import json
import subprocess
import sys
from native_mcp import exchange, McpFailure


def main():
    request = json.load(sys.stdin)
    spec = dict(request['server'])
    secrets = []
    for section in ('env', 'headers'):
        spec[section] = dict(spec.get(section) or {})
        for key, value in list(spec[section].items()):
            if str(value).startswith('reference:'):
                provider = request.get('credentialProvider')
                if not provider:
                    raise McpFailure('MCP_CREDENTIAL_REQUIRED')
                response = subprocess.run(provider, input=json.dumps({'name': str(value)[10:]}).encode('utf-8'), capture_output=True, timeout=15)
                if response.returncode:
                    raise McpFailure('MCP_CREDENTIAL_REQUIRED')
                secret = json.loads(response.stdout.decode('utf-8'))['value']
                if not isinstance(secret, str) or not secret:
                    raise McpFailure('MCP_CREDENTIAL_REQUIRED')
                secrets.append(secret)
                spec[section][key] = secret
    output = {'ok': True, **exchange(spec)}
    encoded = json.dumps(output, ensure_ascii=False)
    for secret in secrets:
        encoded = encoded.replace(json.dumps(secret, ensure_ascii=False)[1:-1], '<credential>')
    print(encoded)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': error.code if isinstance(error, McpFailure) else 'MCP_PROTOCOL_INVALID'}))
        sys.exit(3)
