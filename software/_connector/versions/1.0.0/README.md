# `_connector` — shared software connector 1.0.0

Architecture 3.2, step P3. One JSON message in on stdin, one JSON message out on stdout, launched as
`<python> -B connector.py --config <platform-connector-config.json>` — which is exactly how `wf-runner`
already launches a software gateway (`config.softwareGateway`). A platform that adopts this component
changes one path in its own config; the engine, the contracts and the six published recipes stay as
they are.

## What is in the envelope

| shape | who asks | note |
|---|---|---|
| `ai-software-call/v1`, `ai-software-inventory/v1`, `ai-software-instance/v1` | the engine | the published three, unchanged; responses are validated against repo-lint 0.5.2's published schema in `selftest` |
| `ai-software-session/v1` | a platform or a run needing a long-lived GUI/MCP session | the P2 candidate shape, unchanged: `open`/`status`/`close`, states `SESSION_READY` / `INTERACTIVE_REQUIRED` / `SESSION_BUSY` / `SESSION_CLOSED` / `NOT_INSTALLED` |
| `ai-software-admin/v1` | a platform or a human, never a stage | `software.list`, `software.describe`, `software.health`, `software.artifact`, `software.evidence` |

`software.call` and `software.session` are the entries named by the 3.2 plan; on the wire they are the
published call shape and the session shape. **No new error code appears anywhere** — every refusal uses
the published eleven, and each one names the recipe or config key at fault.

## What a green row actually proves (D-60)

The reference gateway proved a capability was live by asking the body `--tools`. Real third-party CLIs
do not answer that, so the row was only ever proving "the recipe parses, the snapshot is frozen, the
body is registered" — and saying more than that. This connector keeps the distinction in the answer:

* **`snapshot-only`** (default): the capability is declared in the manifest, present in the **frozen**
  snapshot, and the installed body matches the digest the recipe pins in `verify.files`. It does **not**
  claim the body advertised the capability.
* **`native-tools-list`**: only for a recipe whose transport is genuinely native MCP (`mcp-stdio`,
  `mcp-http`) and whose release declares that policy — there the question is one the server can answer,
  and a differing list is `SOFTWARE_DRIFT` with the added and removed names.
* A `cli-wrapper` body is **never** asked for a tool list. If a recipe's argv ever contains `--tools`,
  the connector refuses with `CAPABILITY_UNAVAILABLE` rather than dispatch it.

An unfrozen snapshot is `CAPABILITY_UNAVAILABLE` naming `capabilities.snapshot.json#frozen` — never
reported as drift, because with no baseline there is nothing to compare against. That applies today to
`nmap`, `veracrypt` and `burp-suite`: those three rows are not dispatchable and this component does not
make them look otherwise.

## Resolution rules that used to be guesses

* **Only the pinned release is served.** A request naming a version the pointer does not pin is
  `SOFTWARE_NOT_INSTALLED` naming `asked` and `pinned`, so a stale stage claim cannot reach a body the
  platform never adopted.
* **`${...}` placeholders are resolved or the call is refused**, never shell-expanded. In a recipe,
  `${softwareRoot}` means the *install* directory (`install.detectedPath`), which is what the recipe's
  own `verify.versionCall` lines assume; the shared release directory is `${recipeRoot}`.
* **A bare program name** (`mysql.exe`, `editcap.exe`) resolves against the install directory or
  `config.tools`, and never against `PATH` — a connector that searches PATH can dispatch a different
  program than the one the recipe pinned.
* **Two interpreters stay two things**: the connector's own runtime (Python ≥ 3.9) and the body's
  interpreter, which comes from the frozen snapshot's `runtime.interpreter` alias. When the platform
  resolves that alias to a different program than the recipe launches, the call is `SOFTWARE_DRIFT`.
* **Arguments are validated before argv is built**, against the operation's own input schema (not the
  root `oneOf`), so a refusal names the JSON pointer. A value that would be read as a flag, or that
  carries a control character, is refused. Without an importable validator the connector refuses rather
  than dispatch an unchecked argument set.
* **Credentials travel as `reference:<name>` only** — the same vocabulary the published manifest schema
  already forces. A literal, or a reference the operation does not declare, is refused; nothing a
  connector writes (request, response, evidence, index) ever carries a secret value.
* **Concurrency is decided here because instances are platform state**: `per-run` claims nothing,
  `pooled` counts one slot, `singleton` holds one platform-wide slot, every `exclusiveResources` key is
  a mutual-exclusion lock, and the loser writes nothing at all. Sessions hold their key until `close`.
  The lock table is **platform-internal** — cross-platform arbitration is not required by BP-4 1.3 and
  is not claimed here.
* **Idempotency is answered here too**: a repeated `idempotencyKey` returns `replayed: true` with the
  original `outputSha256`, `exitCode`, `instanceMode` and `evidencePath`, and dispatches nothing. The
  index records completed dispatches; the run-side intent anchor stays the engine's business.
* **Evidence is numbered and exclusive** — `evidence/software-calls/<n>/request.json` (plus
  `response.json`, `artifacts.json`) and `evidence/software-sessions/<n>/request.json`. `argv`, `cwd`,
  the attestation used and the body digest state are all in the request document, so a later reader can
  tell what was verified and what was merely declared.

## Per-release overlay

A release may carry `connector.json` (`ai-software-connector/v1`, the P2 shape) to name its adapter,
its session model and its operations. The six published recipes carry none, and red line 1 means they
will not gain one in place, so **the connector derives the overlay from the manifest and the snapshot**
and says so: every answer reports `declaration: "derived"`. A declared overlay that names a different
release than the manifest beside it is `SOFTWARE_DRIFT`.

The P2 declaration schema has `additionalProperties: false` and no axis for attestation policy, session
instructions, or per-operation network/filesystem words. The connector therefore takes those from
itself (fixed defaults) and from platform config (`allowedHosts`, `tools`, `projectWriteRoots`,
`allowGuiLaunch`) rather than widening a declaration shape it did not write. That gap is registered as
**D-84** for the next contract generation.
