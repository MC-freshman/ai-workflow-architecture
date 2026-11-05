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

# Timeouts (D-149): the initialize budget must cover a cold CLI boot on a live
# config directory (measured 7s clean, up to 36s under marketplace recovery
# contention); the auth budget tracks the CLI's own ~60s abandonment of an
# unanswered auth request instead of waiting far past it; each model turn gets
# its own budget because bounded retries re-send the prompt.
INITIALIZE_TIMEOUT = 120
AUTH_TIMEOUT = 90
MODEL_TURN_TIMEOUT = 120


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
        try:
            deadline = time.monotonic() + INITIALIZE_TIMEOUT
            while time.monotonic() < deadline:
                value = receive(deadline)
                if value.get('type') == 'control_response' and value.get('response', {}).get('request_id') == 'initialize':
                    cached_account = value.get('response', {}).get('response', {}).get('account') or {}
                    break
            else:
                raise ValueError('NATIVE_INITIALIZE_TIMEOUT')
        except queue.Empty:
            raise ValueError('NATIVE_INITIALIZE_TIMEOUT')
        authenticated = bool(cached_account.get('token') and (cached_account.get('userId') or cached_account.get('user_id')))
        cached_account = None
        if not authenticated:
            send({'type': 'control_request', 'request_id': 'auth', 'request': {'subtype': 'authenticate', 'methodId': spec.get('authMethodId', 'external')}})
        try:
            deadline = time.monotonic() + AUTH_TIMEOUT
            while not authenticated and time.monotonic() < deadline:
                value = receive(deadline)
                if value.get('type') == 'control_request':
                    request = value.get('request', {})
                    # Auth callbacks contain real tokens; they never enter the proof trace.
                    if request.get('subtype') == 'auth_url_callback':
                        url = request.get('authState', {}).get('authUrl', '')
                        parsed = urlparse(url)
                        if parsed.scheme != 'https' or parsed.hostname not in ('www.workbuddy.cn', 'www.workbuddy.ai', 'www.codebuddy.cn', 'www.codebuddy.ai') or parsed.path.rstrip('/') != '/login':
                            raise ValueError('NATIVE_LOGIN_URL_INVALID')
                        if spec.get('readinessOnly'):
                            raise ValueError('NATIVE_WORKBUDDY_LOGIN_REQUIRED')
                        print(json.dumps({'type': 'native_auth_url', 'authUrl': url, 'modelTurnStarted': False}), flush=True)
                        webbrowser.open(url)
                        acknowledge(value)
                    if request.get('subtype') == 'auth_result_callback':
                        acknowledge(value)
                        # The callback is an intermediate event. The vendor must finish
                        # the original authenticate request before accepting user input.
                        if request.get('success') is False:
                            raise ValueError('NATIVE_AUTHENTICATION_FAILED')
                if value.get('type') == 'control_response' and value.get('response', {}).get('request_id') == 'auth':
                    response = value.get('response', {})
                    if response.get('subtype') == 'error':
                        raise ValueError('NATIVE_AUTH_REQUEST_REJECTED')
                    # The two-phase protocol may acknowledge acceptance before browser completion.
                    result = response.get('response', {})
                    if result.get('success') is True:
                        authenticated = True
                        break
                    if result.get('success') is False:
                        raise ValueError('NATIVE_AUTHENTICATION_FAILED')
            if not authenticated:
                raise ValueError('NATIVE_AUTH_TIMEOUT')
        except queue.Empty:
            raise ValueError('NATIVE_AUTH_TIMEOUT')
        print(json.dumps({'type': 'native_auth_ready', 'modelTurnStarted': False, 'sameNativeProcess': True, 'credentialRelay': False}), flush=True)
        if spec.get('readinessOnly'):
            return
        # Bounded in-process retries (D-148): the challenge is single-use per
        # service process, so a retry only helps while no successful verify call
        # has consumed it. The manager validates the trace either way.
        max_attempts = max(1, int(spec.get('maxModelAttempts') or 3))
        # D-148: the retry budget and the pause between retries are the manager's decision
        # and are echoed into the attestation; the launcher only honours them.
        retry_delay = min(30.0, max(0.0, float(spec.get('retryDelaySeconds') or 0)))
        attempts = 1
        verified_use_id = None
        verified = False
        print(json.dumps({'type': 'native_model_request', 'modelRequestSubmitted': True}), flush=True)
        send({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': spec['prompt']}]}})
        while True:
            try:
                deadline = time.monotonic() + MODEL_TURN_TIMEOUT
                while time.monotonic() < deadline:
                    value = receive(deadline)
                    if value.get('type') == 'control_request':
                        request = value.get('request', {})
                        allowed = (request.get('subtype') == 'can_use_tool'
                                   and request.get('tool_name') == spec.get('readOnlyTool')
                                   and request.get('input') == spec.get('readOnlyArguments'))
                        response = {'behavior': 'allow', 'updatedInput': request['input']} if allowed else {'behavior': 'deny', 'message': 'Only the exact readonly verification call is authorized.'}
                        send({'type': 'control_response', 'response': {'subtype': 'success', 'request_id': value['request_id'], 'response': response}})
                        if allowed:
                            verified_use_id = request.get('tool_use_id')
                        continue
                    if value.get('type') in ('assistant', 'user', 'system', 'result'):
                        print(json.dumps(value), flush=True)
                        if value.get('type') == 'user':
                            for item in (value.get('message', {}).get('content') or []):
                                if item.get('type') == 'tool_result' and item.get('tool_use_id') == verified_use_id and not item.get('is_error'):
                                    verified = True
                    if value.get('type') == 'result':
                        break
                else:
                    raise ValueError('NATIVE_MODEL_TURN_TIMEOUT')
            except queue.Empty:
                raise ValueError('NATIVE_MODEL_TURN_TIMEOUT')
            if verified or attempts >= max_attempts:
                return
            attempts += 1
            print(json.dumps({'type': 'native_model_retry', 'attempt': attempts, 'maxAttempts': max_attempts, 'retryDelaySeconds': retry_delay, 'modelRequestSubmitted': True}), flush=True)
            if retry_delay:
                time.sleep(retry_delay)
            send({'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'text', 'text': spec['prompt']}]}})
    finally:
        if not child.stdin.closed:
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
        error = str(exc) if str(exc).startswith('NATIVE_') else 'NATIVE_CLIENT_CONNECTION_FAILED'
        # Keep the raw cause beside the classified code; the manager reads only
        # `error`, the trace keeps `detail` for forensics (D-149).
        print(json.dumps({'type': 'native_auth_error', 'error': error, 'detail': f'{type(exc).__name__}: {exc}'}), flush=True)
        sys.exit(1)
