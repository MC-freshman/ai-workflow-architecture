# _gateway - reference software gateway 1.0.0

One JSON message in on stdin, one out on stdout. The engine never speaks MCP and never holds a body process; this component does, and it answers with the adapter contract only.

What it refuses, and why it refuses in *those* words: an unfrozen capability snapshot is `CAPABILITY_UNAVAILABLE` naming `capabilities.snapshot.json#frozen` (no baseline means no comparison - it is never reported as drift), a live list that differs from the frozen baseline is `SOFTWARE_DRIFT` with the added and removed names, a recipe the registry does not carry is `CAPABILITY_UNAVAILABLE` naming `softwareRoot`, a missing installed body is `SOFTWARE_NOT_INSTALLED` naming `bodies.<id>`, a capability needing confirmation is `CONSENT_REQUIRED`, and the loser of an exclusive key is `SOFTWARE_BUSY` naming the key after having written nothing at all.

The interpreter for a script body comes from the platform config (`interpreters`); the gateway will not guess one. Concurrency is decided here because instances are platform state, and the lock table is **platform-internal** - cross-platform arbitration is a separate, still unauthorised item (C-8, inherited from the 2.1-A P8b handoff).
