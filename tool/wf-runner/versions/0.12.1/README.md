
## 0.10.1 — D-25 process-gate replay safety

A process gate is reserved once per run, stage, attempt, and gate ID. The engine writes a durable intent before starting the subprocess and a durable outcome after it finishes. An identical submission reuses that outcome; a different binding returns `IDEMPOTENCY_CONFLICT`; an intent without an outcome returns `UNKNOWN_OUTCOME` and is never replayed. A repair attempt gets a new attempt ID and may execute its gates once.

Verify the release-local regression tests with `python -B -m unittest discover -s tests -v` in the release directory.
