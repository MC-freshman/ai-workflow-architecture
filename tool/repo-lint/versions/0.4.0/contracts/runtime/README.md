# Runtime Contract 1.1

Decision date: 2026-09-05. Scope: M6-01 through M6-04, Phase 0.
These are candidate contracts for the future runner, not evidence that the
runner, persistence, cancellation, concurrency or business execution exists.

## Files and version boundaries

All schemas use JSON Schema 2020-12. `common.schema.json` contains local shared
types; the other schemas reference it. Unknown fields are rejected. Format
validation is mandatory, not optional. The validator supplies a strict
date-time checker without optional format dependencies: full seconds and a
UTC offset are required; leap-second timestamps are outside this profile.
Schema IDs are identifiers only; the
validator resolves the supplied local files without network access.

| File | Contract |
| --- | --- |
| `run-lock.schema.json` | Immutable `ai-run-lock/v1.1` execution lock |
| `state.schema.json` | Mutable `ai-run-state/v1.1` progress snapshot |
| `event.schema.json` | One `ai-run-event/v1.1` JSONL event |
| `protocol.schema.json` | `ai-run-protocol/v1.1` request or response |
| `transaction.schema.json` | Durable protocol intent and idempotency receipt |
| `examples/valid-scenario.json` | Synthetic seed for complete positive bundles |
| `examples/negative-cases.json` | Reproducible invalid mutations and expected errors |
| `validate_contracts.py` | Static schema, hash and cross-record validation |

Historical locks with `schemaVersion: "ai-run-lock/v1"` or `schema:
"ai-run-lock/v1"` are explicitly not v1.1. Display them read-only with their
original hash algorithm and missing evidence marked information-insufficient.
Prepared is not success. Historical `Schema: ai-maintenance-run-lock/v1`
maintenance records, including their uppercase field names, are classified
separately. A maintenance record is not an executable run and
cannot be recovered. The validator's history classifier only classifies; it
does not validate, migrate or rewrite a historical record. Other unrecognized
formats return unsupported, never silently upgraded. Phase 1 must implement
and test historical reports against actual v1 samples.

## Directory and ownership

```text
<platform>/runtime/runs/<run-id>/
  run-lock.json                    immutable after prepare commits
  state.json                       sole mutable progress snapshot
  events.jsonl                     append-only committed event chain
  transactions/<request-id>.json   durable intent and committed response
  inputs/                         immutable authorized input copies
  work/project/                   generated source and working outputs
  evidence/<stage-id>/<attempt>/   immutable attempt evidence
  output/                         final artifacts
  logs/                           redacted process logs
  reports/                        read-only reports, exception evidence
```

The authenticated platform supplies its allowlisted run root. A request cannot
grant another platform's directory by naming it. Lexical schema path checks are
only syntax checks: Phase 1 must resolve real filesystem paths and junctions,
reject aliases/case collisions, enforce directory ownership and use exclusive
creation. No credentials, session contents or secrets enter the lock or events.
The schema's `runRoot` is an absolute path and must end in `runId`; it never
authorizes a new root by itself. Input and evidence paths are run-relative.

`prepare` copies the explicitly authorized files into `inputs/`, hashes the
copied raw bytes, verifies no source changed during copying, and freezes their
ordered manifest plus canonical parameter hash. `projectRoot` alone is not an
input snapshot. Even an empty input set has an explicit empty manifest hash.
Permissions to copy inputs must exist before the copy. Symlinks must be
rejected or materialized under a separately reviewed policy; first release
rejects them. An attempt consumes the immutable initial snapshot plus an
explicit list of prior successful attempt artifacts. Generated code/config
goes under `work/project/`; each submitted output is copied to immutable
attempt evidence and hashed there. Never add new code to the initial lock.

Each locked resource has an exact version, its installed source path, raw
manifest and content-manifest hashes, resolution source, and exact dependency
edges. The roots are the selected agent (nullable), workflow, runner, and
environment resources. Every resource must be reachable from those roots;
every declared edge must resolve to the named exact version. The initial
release supports prompt/script only and serial scheduling. It does not offer
peer invocation. An agent-to-workflow edge must have `tool-lock` provenance;
top-level explicit/default selection cannot repair missing internal authority.
The validator checks the declared closure, but reading manifests and proving
that no real dependency was omitted remain prepare/repo-lint responsibilities.
Raw file digests prove bytes, not file permissions or executable capability.

## Canonical hashing

Algorithm ID: `sha256-cjson-safe-v1`. This is a deliberately restricted JSON
profile, not a claim of RFC 8785 conformance:

1. Parse UTF-8 JSON with duplicate property names rejected. Reject a BOM,
   NaN, Infinity, floats and exponent-form numeric tokens. Numbers must be
   integers in `[-9007199254740991, 9007199254740991]`; use strings for exact
   decimal/scientific values. Negative zero becomes integer zero.
2. Reject unpaired UTF-16 surrogates. Preserve valid Unicode without NFC/NFD
   normalization. Sort object keys lexicographically by Unicode code point.
3. Serialize compact JSON: commas and colons only, lowercase literals, base-10
   integers, standard JSON quote/backslash/control-character escapes, no ASCII
   escaping for other Unicode. Array order is significant. Encode UTF-8 with
   no BOM, trailing newline or other whitespace.
4. SHA-256 that byte sequence and render 64 lowercase hexadecimal digits.

The reference function is `canonical_bytes` in the validator. Parameters use
that function directly. Input manifest hash covers its complete `files` array
sorted by `path`; each file hash instead covers unchanged raw bytes. The
`snapshotSha256` covers `{parametersSha256, manifestSha256}`. The immutable
lock hash covers the entire lock document (it has no self-hash).
Attempt `inputSha256` covers `{initialInputSha256, artifacts}`, where artifacts
are explicit immutable prior outputs sorted by path. Event `eventSha256`
covers every field except `eventSha256`, with `previousEventSha256` chaining
the previous event. Event 1 has a null previous hash. A transaction's
`requestSha256` covers the complete request except `requestId`; thus retrying
the same idempotency key requires identical operation, revision and payload.

## State machine and termination

| From | Allowed next status | Condition |
| --- | --- | --- |
| prepared | running, blocked, failed, stopped | First claim or preflight failure; stop requires no managed process alive |
| running | waiting-for-input, blocked, failed, succeeded, stopped | Prompt handoff; gate failure; complete success; confirmed cancellation |
| waiting-for-input | running, blocked, failed, stopped | Accepted current attempt result or confirmed cancellation |
| blocked | stopped | Explicit user stop after process termination confirmation |
| failed, succeeded, stopped | none | Absorbing terminal states |

A repeated status during an event is allowed, for example a next stage claim,
stop request, or process-exit observation. `stateRevision` advances exactly once
per committed event, as does `lastEventSequence`; a status request and an
idempotent replay do not advance either. Initial prepared state is revision 0,
with event sequence 1 (`prepared`). Each event links previous/new revisions;
events after initialization use `newRevision = previousRevision + 1`. One
protocol transaction may commit consecutive events, for example claim then
prompt handoff. Those events share transactionId, and its receipt enumerates
their `eventSequences`; its stored response points to the final event. A
rejected request has an empty eventSequences array and does not change state.
A successful next with no task may also return unchanged state with no event;
the receipt still persists its response for subsequent identical retries.
Autonomous process observations use separate transaction IDs; they are not
invented user requests or idempotency receipts.

`waiting-for-input` requires a prompt `activeAttempt`. `running` may hold a
script or accepted prompt attempt. No active attempt survives a terminal
state. All terminal states require an empty `managedProcesses` array.
`succeeded` requires every locked stage completed, every required gate passed,
and `finalOutput` evidence. `failed` means a known failure. Unknown side effects
must become `blocked`, `outcome: unknown-outcome`, `error.code: UNKNOWN_OUTCOME`.
Unknown outcomes cannot become success or be replayed. After confirmed stop,
retain `unknown-outcome` rather than pretending effects were undone.

`stopRequested` is a flag, not a status. `stop` sets it and commits a response;
the response may still report running/waiting/blocked. A later confirmed
process-tree exit permits `stopped`. No new next or submit is accepted after
the flag is set. Late submissions never revive a terminal run. An unconfirmed
process exit must not be represented by merely deleting its process record.
Timeout records a known failure only after managed processes have ended and
the effects are known; otherwise it blocks with unknown outcome.

There is no resume operation. Do not re-read current.json to reconstruct a run.
After manual inspection, a user may authorize a new run with `parentRunId`;
prepare snapshots new inputs and resolves a fresh exact closure. It is not
permission to replay an old uncertain attempt.

## Protocol and error behavior

All request/response pairs share protocol version, requestId, operation and
runId. Successful responses contain a result and no error; rejected responses
contain an error and no result. Protocol rejection is not itself a successful
business stage. Read-only status never claims a writer lease or changes state.

| Operation | Required request content | Result |
| --- | --- | --- |
| prepare | idempotency key; platform; explicit target; authorized input sources, parameters | immutable lock hash and prepared state |
| next | idempotency key; expectedStateRevision | one claimed task, or no task with reason; claim is durable before delivery |
| submit | idempotency key; expectedStateRevision; stageId, attempt, inputSha256; output and gate evidence | accepted result and current state after schema/gate checks |
| status | no idempotency key or revision | persisted state and immutable lock hash; information only |
| stop | idempotency key; expectedStateRevision; reason | persisted state; stopped only once process exit is confirmed |

Stage task input contains initialInputSha256 plus explicit artifact hashes.
The response never injects a system prompt. Prompt tasks return text and
allowed tools to the existing session. Script tasks identify an exact locked
resource/entry and structured string arguments; entry allowlists and actual
capabilities must be verified before execution. A caller cannot supply a new
script or widen tools in submit. Required gates are fixed by the lock; missing,
unimplemented or stale gates block. Each gate binds the same attempt input
and exact output-manifest digest. Phase 0 validates declarations only.

Error codes: `INVALID_REQUEST`, `UNSUPPORTED_SCHEMA`, `REVISION_CONFLICT`,
`IDEMPOTENCY_CONFLICT`, `STALE_ATTEMPT`, `INPUT_MISMATCH`, `HASH_MISMATCH`,
`REQUIRED_GATE_MISSING`, `CAPABILITY_UNAVAILABLE`, `UNAUTHORIZED`,
`TERMINAL_RUN`, `STOP_REQUESTED`, `UNKNOWN_OUTCOME`, `PERSISTENCE_ERROR`,
`EXECUTION_FAILED`, `GATE_FAILED`, `TIMEOUT`.
Error `retryable` describes whether repeating the exact request can be useful;
it never authorizes retrying business effects. Conflict and stale errors are
nonretryable for the unchanged request. A client must inspect status and issue
a new operation/key only when the documented state allows it.

## Writer, durability and idempotency

Each run has one OS-enforced writer lock acquired for every mutation. In
addition, next/submit/stop use expectedStateRevision as a compare-and-swap
precondition. A writer identity stored in JSON is not a lock. A crashed writer
must not be replaced merely because a clock lease expired. OS lock release
and process liveness require verification. No parallel next execution.

Idempotency namespace is `(platform, runId, idempotencyKey)`, shared across
mutating operations. Lookup occurs after authentication, before revision or
terminal checks, so an already committed success can be replayed after the
state moved forward. The same key and requestSha256 returns the exact stored
response, including its original requestId. Clients retain the requestId when
retrying. Different payload/operation/revision returns IDEMPOTENCY_CONFLICT.
Uncommitted intent never implies a committed response or permission to replay.

Under the writer lock: validate request, persist an intent with request hash
and exact task claim, flush it, record irreversible-effect boundary, execute
only when authorized, then persist outputs/response, event and new state with
the same transactionId. Committed receipt eventSequences must reference only
that transaction's consecutive events. Use exclusive creates for lock/evidence, temporary
files plus atomic same-volume replacement for state, and explicit fsync/flush
plus a write-ahead commit marker. Multi-file writes are not one atomic rename.
The Phase 1 implementation must select and test an exact transaction protocol;
this contract requires detectable incomplete commits and no false success.

| Fault or retry | Required disposition |
| --- | --- |
| Same key, same committed request, response lost | Return stored response without side effects or revision increment |
| Same key, different request | Reject; no state change |
| Two next at one revision | One claim; loser revision conflict, unless same committed key is replayed |
| Old attempt or input submitted | Reject; no business effect |
| Crash before effect boundary with incomplete intent | Block pending inspection; no automatic replay in first release |
| Crash after effects but before durable commit | UNKNOWN_OUTCOME; retain evidence and block |
| Complete durable transaction, state cache stale | Read-only report may reconstruct committed state; do not execute work |
| Stop pending, process still alive | Keep nonterminal status and stopRequested=true |
| Terminal run, late new submit | TERMINAL_RUN; terminal state unchanged |

No exactly-once side effect claim is made. Durable at-most-once claim delivery
and idempotent response replay do not prove an external operation ran once.

## Static validation and Phase 1 handoff

Run with the calling platform's pinned environment, with bytecode disabled and
report output inside its authorized runtime directory. For the Codex W/R layout:

```powershell
& W\.venv\Scripts\python.exe -B W\contracts\runtime\validate_contracts.py --runtime-root R --report R\reports\runtime-contract-tests.json
```

Replace W/R with the runbook's actual absolute paths. `--runtime-root` is
mandatory and must already exist. Both resolved output paths must remain
inside that root. Existing reports and `positive-example-bundles.json` are
never overwritten; use a new report subdirectory for a new verification run.
Outputs use exclusive file creation. If writing one file fails, preserve any
partial evidence; the two output files are not an atomic transaction.

The caller is responsible for platform identity, ownership and authorization
of the supplied root. This output-path check is not a sandbox and does not
authorize cross-platform writes or protect against hostile concurrent
filesystem changes. Synthetic example path strings do not determine the
actual output root and do not access the illustrated resources.

The script checks schema
self-validity, local references, a positive synthetic bundle, invalid fixtures,
canonical vectors, and cross-record invariants. It writes materialized positive
lock/state/event/request/response examples beside its report as
`positive-example-bundles.json`; all bytes and resources are synthetic, and
the example files are not actual runs. It does not execute workflows,
write runtime state, acquire writer locks, validate ACLs, prove fsync durability,
or test real process termination. Those remain M6-05 through M6-10 / M2.

## 0.2.0

`state.schema.json`, `event.schema.json` and `protocol.schema.json` keep their `$id` path (`.../1.1/`) but
now accept the 1.2 record versions additively: `ai-run-state/v1.2` (optional `repairLedger`),
`ai-run-event/v1.2` (`attempt-failed`), `ai-run-protocol/v1.2` (`delegate`, submit reason `"repair"`).
Reading is dual-version; writing 1.2 requires an engine that maintains the new fields. Version 1.1
documents are validated exactly as before, including the ban on `task`/`reason` outside `next` responses.
`x-`-prefixed properties are accepted in every closed object and are recorded by lint rule R15.
