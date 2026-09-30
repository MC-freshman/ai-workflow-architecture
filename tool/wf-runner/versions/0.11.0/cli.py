"""JSON protocol adapter. Configuration is supplied by the platform launcher.

wf-runner 0.7.0 — C2a (ADR-2): unified machine-readable error envelope.
Every failure path emits exactly ONE JSON document on stdout; the full traceback
goes to a de-identified platform diagnostic file referenced by diagnosticRef.
The v1 shape {ok:false, error:{code,message,retryable}} is preserved (callers keep
working) and extended with requestId/operation/runId/phase/outcome/diagnosticRef so
rejections are mechanically classifiable across CLI/MCP/Skill entrances (gate 1 format).
"""
import argparse
import json
import sys
import tempfile
import traceback
import uuid
from pathlib import Path

from engine import Engine
from runtime_core import Rejected
from jsonschema.exceptions import ValidationError

# Rejections whose same configuration must NOT be retried unchanged (ADR-2).
NON_RETRYABLE = {
    "UNSUPPORTED_PROTOCOL", "UNSUPPORTED_OPERATION", "CAPABILITY_UNAVAILABLE",
    "VERSION_CONFLICT", "INTEGRITY_MISMATCH", "HASH_MISMATCH", "IDEMPOTENCY_CONFLICT",
    "UNAUTHORIZED", "TERMINAL_RUN", "PERSISTENCE_ERROR", "STALE_ATTEMPT", "INPUT_MISMATCH",
}


def _emit(envelope):
    """Write exactly one protocol document to stdout, as UTF-8, whatever the console codepage.

    D-15 (2.0.x repair): the previous one-liner encoded with the *ambient* codepage, so on a
    Windows ANSI console any response carrying characters outside it - emoji in a workflow
    definition is enough - raised UnicodeEncodeError inside the runner and the caller either
    got nothing or got a misclassified envelope. Writing bytes through the binary layer removes
    the dependency; the ASCII-escaped retry is a last resort so that the protocol promise
    "one JSON document on stdout" can never be broken by an encoding problem.
    """
    text = json.dumps(envelope, ensure_ascii=False)
    buf = getattr(sys.stdout, "buffer", None)
    try:
        if buf is not None:
            buf.write(text.encode("utf-8") + b"\n")
            buf.flush()
            return
        print(text)
    except (UnicodeError, ValueError, OSError):
        if buf is None:
            raise
        buf.write(json.dumps(envelope, ensure_ascii=True).encode("ascii") + b"\n")
        buf.flush()


def _diag_dir(config):
    root = config.get("platformRoot") if isinstance(config, dict) else None
    base = (Path(root) / "runtime" / "logs" / "wf-runner") if root else Path(tempfile.gettempdir())
    try:
        base.mkdir(parents=True, exist_ok=True)
        return base, (root is not None)
    except OSError:
        return Path(tempfile.gettempdir()), False


def _write_diagnostic(config, exc):
    ident = uuid.uuid4().hex
    base, under_platform = _diag_dir(config)
    try:
        (base / (ident + ".log")).write_text(
            "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)), encoding="utf-8")
    except OSError:
        return None
    return ("runtime/logs/wf-runner/" + ident + ".log") if under_platform else str(base / (ident + ".log"))


def _identity(args):
    """Best-effort request correlation; never trusts malformed input."""
    rid = op = run_id = None
    if getattr(args, "request", None):
        try:
            raw = json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
            if isinstance(raw, dict):
                rid, op, run_id = raw.get("requestId"), raw.get("operation"), raw.get("runId")
        except (OSError, ValueError):
            pass
    if op is None:
        if getattr(args, "history", None):
            op = "history"
        elif getattr(args, "execute", None):
            op = "execute"
        else:
            op = "config"
    return rid, op, run_id


def _envelope(code, message, *, rid, op, run_id, phase, outcome="known", retryable=None, diag=None):
    if retryable is None:
        retryable = code not in NON_RETRYABLE
    return {
        "ok": False,
        "error": {"code": code, "message": message, "retryable": bool(retryable)},
        "requestId": rid, "operation": op, "runId": run_id,
        "phase": phase, "outcome": outcome, "diagnosticRef": diag,
    }


def _rejected(e, rid, op, run_id, phase, config):
    _emit(_envelope(e.code, str(e), rid=rid, op=op, run_id=run_id, phase=phase, diag=_write_diagnostic(config, e)))
    return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--execute', metavar='RUN_ID')
    parser.add_argument('--tool', choices=['render-figure', 'record-visual-review'])
    parser.add_argument('--review', type=Path)
    parser.add_argument('--history', type=Path)
    args = parser.parse_args()
    rid, op, run_id = _identity(args)

    # 1) config read
    try:
        config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    except FileNotFoundError as e:
        _emit(_envelope("INVALID_REQUEST", "config file not found", rid=rid, op="config", run_id=None,
                        phase="config", retryable=False, diag=_write_diagnostic(None, e))); return 1
    except (ValueError, OSError) as e:
        _emit(_envelope("INVALID_REQUEST", "config is not valid JSON", rid=rid, op="config", run_id=None,
                        phase="config", retryable=False, diag=_write_diagnostic(None, e))); return 1

    # 2) engine init
    try:
        engine = Engine(config)
    except Rejected as e:
        return _rejected(e, rid, "config", run_id, "config", config)
    except (ValueError, ValidationError) as e:
        _emit(_envelope("CONTRACT_VIOLATION", "engine configuration rejected", rid=rid, op="config", run_id=run_id,
                        phase="config", retryable=False, diag=_write_diagnostic(config, e))); return 1
    except Exception as e:
        _emit(_envelope("INTERNAL_ERROR", "engine initialization failed", rid=rid, op="config", run_id=run_id,
                        phase="config", outcome="unknown", diag=_write_diagnostic(config, e))); return 2

    # 3) dispatch / execute / history
    try:
        if args.history:
            result = engine.history(args.history)
        elif args.execute:
            result = engine.execute_claimed(args.execute, args.tool,
                                            json.loads(args.review.read_text(encoding='utf-8')) if args.review else None)
        elif args.request:
            result = engine.dispatch(engine.c.read(args.request))
        else:
            parser.error('A request, claimed execution or history record is required')
            return 2
    except Rejected as e:
        return _rejected(e, rid, op, run_id, "engine", config)
    except (ValueError, ValidationError) as e:
        # strict_load / schema validation on request|review payloads -> caller-correctable
        _emit(_envelope("INVALID_REQUEST", "request or review payload is not valid", rid=rid, op=op, run_id=run_id,
                        phase="request", retryable=False, diag=_write_diagnostic(config, e))); return 1
    except Exception as e:
        _emit(_envelope("INTERNAL_ERROR", "unexpected runner failure", rid=rid, op=op, run_id=run_id,
                        phase="internal", outcome="unknown", diag=_write_diagnostic(config, e))); return 2
    # Delivery happens outside the handler above (D-16): a transaction may already have
    # committed by now, so an undeliverable response must never be dressed up as the
    # caller-correctable INVALID_REQUEST. It is reported as the runner's own failure with
    # outcome=unknown, which tells the caller to reconcile through `status`.
    try:
        _emit(result)
    except Exception as e:
        _emit(_envelope("INTERNAL_ERROR", "runner could not deliver its response", rid=rid, op=op, run_id=run_id,
                        phase="internal", outcome="unknown", diag=_write_diagnostic(config, e))); return 2
    return 0 if result.get('ok', True) else 1


if __name__ == '__main__':
    raise SystemExit(main())
