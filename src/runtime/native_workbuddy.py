"""Vendor-owned auth and tool turn in one native process; never export auth tokens."""
import json
import os
import queue
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse
import webbrowser


def main():
    spec = json.load(sys.stdin)
    child = subprocess.Popen(spec['argv'], cwd=spec['cwd'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    messages = queue.Queue()
    def collect():
        for line in child.stdout:
            try:
                messages.put(json.loads(line))
            except (ValueError, UnicodeError):
                continue
        messages.put({'closed': True})
    collector = threading.Thread(target=collect, daemon=True)
    collector.start()
    def send(value):
        child.stdin.write((json.dumps(value) + '\n').encode())
        child.stdin.flush()
    def receive(deadline):
        value = messages.get(timeout=max(.1, deadline-time.monotonic()))
        if value.get('closed'):
            raise ValueError('NATIVE_AUTH_CONNECTION_CLOSED')
        return value
    def acknowledge(value):
        detail = {'received': True} if value.get('request', {}).get('subtype') == 'auth_url_callback' else {'handled': True}
        send({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': value['request_id'], 'response': detail}})
    try:
        cached_account = {}
        send({'type': 'control_request', 'request_id': 'initialize', 'request': {'subtype': 'initialize'}})
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            value = receive(deadline)
            if value.get('type') == 'control_response' and value.get('response', {}).get('request_id') == 'initialize':
                cached_account = value.get('response', {}).get('response', {}).get('account') or {}
                break
        else:
            raise ValueError('NATIVE_WORKBUDDY_LOGIN_REQUIRED')
        auth_token = cached_account.get('token')
        auth_user_id = cached_account.get('userId') or cached_account.get('user_id')
        authenticated = bool(auth_token and auth_user_id)
        if not authenticated:
            send({'type': 'control_request', 'request_id': 'auth', 'request': {'subtype': 'authenticate', 'methodId': spec.get('authMethodId', 'external')}})
        deadline = time.monotonic() + 240
        while not authenticated and time.monotonic() < deadline:
            value = receive(deadline)
            if value.get('type') == 'control_request':
                request = value.get('request', {})
                # Auth callbacks contain real tokens; they never enter the proof trace.
                if request.get('subtype') == 'auth_url_callback':
                    url = request.get('authState', {}).get('authUrl', '')
                    parsed = urlparse(url)
                    if parsed.scheme != 'https' or parsed.hostname not in ('www.workbuddy.cn', 'www.workbuddy.ai', 'www.codebuddy.cn', 'www.codebuddy.ai') or parsed.path != '/login':
                        raise ValueError('NATIVE_LOGIN_URL_INVALID')
                    if spec.get('readinessOnly'):
                        raise ValueError('NATIVE_WORKBUDDY_LOGIN_REQUIRED')
                    print(json.dumps({'type': 'native_auth_url', 'authUrl': url, 'modelTurnStarted': False}), flush=True)
                    webbrowser.open(url)
                    acknowledge(value)
                if request.get('subtype') == 'auth_result_callback':
                    authenticated = request.get('success') is True
                    info = request.get('userinfo') or {}
                    auth_token = info.get('token') or info.get('accessToken') or info.get('access_token')
                    auth_user_id = info.get('userId') or info.get('user_id') or info.get('uid')
                    acknowledge(value)
                    if authenticated:
                        break
            if value.get('type') == 'control_response' and value.get('response', {}).get('request_id') == 'auth':
                response = value.get('response', {})
                if response.get('subtype') == 'error':
                    raise ValueError('NATIVE_AUTH_REQUEST_REJECTED')
                # The two-phase protocol may acknowledge acceptance before browser completion.
                result = response.get('response', {})
                if result.get('success') is True:
                    authenticated = True
                    info = result.get('userinfo') or {}
                    auth_token = info.get('token') or info.get('accessToken') or info.get('access_token') or auth_token
                    auth_user_id = info.get('userId') or info.get('user_id') or info.get('uid') or auth_user_id
                    break
                if result.get('success') is False:
                    raise ValueError('NATIVE_AUTHENTICATION_FAILED')
        if not authenticated:
            raise ValueError('NATIVE_WORKBUDDY_LOGIN_REQUIRED')
        print(json.dumps({'type': 'native_auth_ready', 'modelTurnStarted': False, 'credentialAvailable': bool(auth_token), 'identityAvailable': bool(auth_user_id)}), flush=True)
        if spec.get('readinessOnly'):
            return
        if not auth_token:
            raise ValueError('NATIVE_CREDENTIAL_RELAY_REQUIRED')
        if auth_token:
            # Official CLI CODEBUDDY_AUTH_TOKEN route. Keep vendor OAuth token in memory only.
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
            collector.join(timeout=1)
            messages = queue.Queue()
            native_env = {**os.environ, 'CODEBUDDY_AUTH_TOKEN': auth_token}
            if spec.get('authentication'):
                authentication = dict(spec['authentication'])
                authentication['type'] = 'custom-token'
                authentication['attributes'] = {**authentication.get('attributes', {}), 'token': auth_token, 'username': auth_user_id}
                # The vendor enables its custom-token storage through this native V3 overlay.
                native_env['ACC_PRODUCT_CONFIG_V3'] = json.dumps({'authentication': authentication})
            if auth_user_id:
                if '\r' in str(auth_user_id) or '\n' in str(auth_user_id):
                    raise ValueError('NATIVE_CLIENT_RECEIPT_MISMATCH')
                native_env['CODEBUDDY_CUSTOM_HEADERS'] = 'X-User-Id: ' + str(auth_user_id)
            child = subprocess.Popen(spec['argv'], cwd=spec['cwd'], env=native_env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            auth_token = None
            del native_env
            collector = threading.Thread(target=collect, daemon=True)
            collector.start()
            send({'type': 'control_request', 'request_id': 'initialize-model', 'request': {'subtype': 'initialize'}})
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                value = receive(deadline)
                if value.get('type') == 'control_response' and value.get('response', {}).get('request_id') == 'initialize-model':
                    break
            else:
                raise ValueError('NATIVE_WORKBUDDY_LOGIN_REQUIRED')
        print(json.dumps({'type': 'native_model_request', 'modelRequestSubmitted': True}), flush=True)
        send({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': spec['prompt']}]}})
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            value = receive(deadline)
            if value.get('type') == 'control_request':
                # A readonly tool is preallowed; all other interactive actions are denied.
                send({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': value['request_id'], 'response': {'behavior': 'deny', 'message': 'Only the preallowed readonly verification tool is authorized.'}}})
                continue
            if value.get('type') in ('assistant', 'user', 'system', 'result'):
                print(json.dumps(value), flush=True)
            if value.get('type') == 'result':
                return
        raise ValueError('NATIVE_AI_ATTEMPT_STOPPED')
    finally:
        child.stdin.close()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'type': 'native_auth_error', 'error': str(exc) if str(exc).startswith('NATIVE_') else 'NATIVE_CLIENT_CONNECTION_FAILED'}), flush=True)
        sys.exit(1)
