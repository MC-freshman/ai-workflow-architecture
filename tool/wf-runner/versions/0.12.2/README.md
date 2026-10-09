
# wf-runner 0.12.2

Adds an optional maintenance-only CLI interface:

```text
python -B cli.py --config <platform-config.json> --invocation-smoke <prepare-request.json>
```

The request is an ordinary `ai-run-protocol/v1.1` fresh workflow/agent `prepare` request.
One Engine dispatches the same guarded `prepare`, `next`, and `stop` operations. The
response is `ai-invocation-smoke/v1`, with each original response in `steps`, phase
timings, and `runnerStarts: 1`. It never executes or submits a business stage, never
initializes an existing run, and refuses resume, software, or unrelated operations.
A rejected prepare does not dispatch next/stop; a rejected next still stops the owned
run at its observed revision. Normal CLI requests and existing pinned runs remain
available. The platform config must explicitly adopt the intended runner/scanner pair;
publishing this release does not change a pointer or another platform.

The interface is declared as `interface.x-invocationSmoke`; compatible matrix judges
may use it, while older runners continue through separate ordinary CLI requests.
Cancellation belongs to the platform's owned process controller, followed by cleanup
of unfinished maintenance runs. Timing labels distinguish Engine initialization,
prepare/next/stop, and process startup/transport. These timings are not business
execution timings. Run the interface regressions with
`python -B -m unittest discover -s tests -p test_invocation_smoke.py -v`.

## 0.10.1 — D-25 process-gate replay safety

A process gate is reserved once per run, stage, attempt, and gate ID. The engine writes a durable intent before starting the subprocess and a durable outcome after it finishes. An identical submission reuses that outcome; a different binding returns `IDEMPOTENCY_CONFLICT`; an intent without an outcome returns `UNKNOWN_OUTCOME` and is never replayed. A repair attempt gets a new attempt ID and may execute its gates once.

Verify the release-local regression tests with `python -B -m unittest discover -s tests -v` in the release directory.
