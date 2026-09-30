# Shared Tool Registry

Canonical shared registry for reusable Skills, capability packs, and Workflows
used by every integrated runtime platform (codex, dsh, workbuddy, zcode, doubao,
qoder). Per BP-2 no platform has extra runtime privilege from authorship or
session identity; per BP-1 `tool` is one of three symmetric shared repositories
(`tool` + `agent` + `software`) and none of the three may be dropped or bypassed.

- Architecture basic principles (superior to this file): `E:\ai\versions\架构基本原则.md`
  — BP-1 three-repo skeleton immutable / BP-2 platform parity + capability floor
  (onboarding is complete only at 0 `declaredAbsent` over the shared capability union)
  / BP-3 acceptance and onboarding kept minimal (single `conform` digest, incremental
  hash-based re-attestation; full matrix only at first onboarding and engine-major upgrades)
  / BP-4 one project split across runs on different platforms must feel like one platform
  / BP-5 stepwise execution and closure: any plan entering execution must first be cut into
  ordered P steps of about 2-3 hours each, every P split into 2-4 sub-blocks with a safe
  interrupt point; execution follows the approved plan strictly, non-blocking defects are
  logged (not fixed on the spot) and get one consolidated fix plan after close-out; and
  running every P step to its pre-written criteria means the update is complete - criteria
  are frozen at plan sign-off and may not be raised mid-round, waiting-type observations go
  to the post-completion maintenance period.

- Registry: E:\ai\tool\registry.json
- Skill catalog: E:\ai\tool\_registry\skills-<source>.json
- Published Skills: E:\ai\tool\skills\<skill-id>\versions\<version>
- Published Workflows: E:\ai\tool\<workflow-id>\versions\<version>
- Published capability packs: E:\ai\tool\packs\<pack-id>\versions\<version>
- Runtime state and output belong to the consuming platform.
- Published versions are immutable. Create a new version directory for every change.
- Runtime resolution records exact versions and their sources. Top-level explicit
  selection and platform-local Agent defaults may take precedence over `current.json`;
  an Agent's internal resources must obey its exact `tool-lock.json`. A run pins the
  Agent, Pack, Skill, Workflow, renderer, and dependencies before execution and
  records the set in the consuming platform's `runtime\runs\<run-id>\run-lock.json`.
- Agents receive only an allowlisted, version-locked subset of Skills. Packs are
  selectors and conflict boundaries, not a reason to preload every Skill into a
  model context.
- Stable interfaces and workflow definitions live here; platform adapters and all runtime output belong to the consuming platform.

## Current Status (2026-09-19 read-back; supersedes the 2026-09-05 section)

`tool/registry.json` lists **27 Workflows**, eight Skill catalogs and eight Packs,
plus `contracts` and `governance` entries. Counts are an inventory, not a claim that
every release passed runtime validation.

Machine-readable shared current pointers on disk today (`<id>/current.json`):
`wf-runner 0.7.9` (20 published generations, 0.1.0-0.9.0), `repo-lint 0.3.0`
(7 generations, 0.1.0-0.4.0), `runtime-contracts 1.1.0` (6 generations, 1.0.0-1.3.0),
`platform-conformance 1.1.0` (4 generations, 1.0.0-1.3.0), `architecture-ops 1.1.0`
(3 generations, 1.0.0-1.2.0). Selection and pointers are two separate mechanisms: a
platform may pin a different generation in its own config without moving a shared
pointer (qoder and zcode both run production on an explicit `0.7.7`).

**Nothing above changed on 2026-09-21**, when architecture 3.0.0 published five more
generations into this repository (framework side, **zero pointer flips**, evidence in
`E:\ai\qoder\runtime\maintenance\3.0-A\` and the baseline `versions\架构3.0.0.md`):

* **`wf-runner 0.9.0`** - the fourth stage action `software-call` and the fixed eight-step
  gate chain `declared → snapshot → profile → boundary → consent → arguments → idempotency →
  dispatch`, where every refusal happens before dispatch; an engine-computed idempotency key
  with an exclusive intent anchor plus the gateway's replay anchor, so re-executing a call
  answers `replayed` instead of calling the software twice; `ai-run-lock/v1.3` records the
  gateway bytes, the declared release with its snapshot digest and the per-stage instance
  mode; the `software-called` event binds request and response bytes. A software-call stage is
  refused a repair path at compile time, and mid-run consent round trips are not implemented -
  both are named in the release's `SOURCE.openDeferred`. Its published manifest pins
  `workflows.repo-lint = 0.4.0` (the pairing the round registered as D-49: an engine that can
  speak `software-call` must not be linted by a scanner that cannot).
* **`repo-lint 0.4.0`** - the `software` section in the scanner (until this generation the
  software repository was invisible to it: D-37), the `software-call` stage vocabulary (R7),
  the `dependencies.software` manifest key, four software shape schemas (`ai-software/v1`,
  recipe, gateway adapter, selftest), the registration-level `SOFTWARE_RECIPE_MISSING` finding
  for a declared-but-absent OS recipe, and live-scope enforcement that a passed software root
  must arrive through the `/shared/software` read-only mount like the other two roots.
* **`runtime-contracts 1.3.0`** - the action enum, the lock's software block, the
  `evidence/software-calls/` layout, seven software error codes, the `software-called` event
  generation, and `attempt.action` completed. Verified as a pure increment: every document
  that was valid under 1.2.2 is valid here (re-checked against real lock bytes).
* **`platform-conformance 1.3.0`** - the union gains the software axis, and
  `conform --only <softwareId>` returns the same report shape with `unionSha256` still computed
  over the whole union and only the rows narrowed, so a single software re-check never costs a
  matrix again (BP-3); an empty row set may not answer "green" (D-32).
* **`architecture-ops 1.2.0`** - `switch_defaults` reaches the third repository through one
  table (`toolRoot`/`agentRoot`/`softwareRoot`), and the acceptance harness gained the software
  rows: one cell per enabled recipe, green only when its pinned release resolves, its capability
  snapshot is frozen and this platform registered a verified body, with every other row naming
  its registered gap code.

Published on 2026-09-20 by the architecture 2.1.0 round (framework side), **not adopted
by any pointer**:
* **`wf-runner 0.8.0`** - the rigor tiers (`fast`/`balanced`/`full`, cost only: gates, seal
  documents, round trips), one authoritative environment hash per run with incremental reuse
  afterwards, the script execution ladder `kernel-sandbox → platform-venv → host-controlled`
  where only the host rung needs the run's own consent, and the BP-4 handoff mechanisms
  (neutral `handoff-bundle/v1` export/import, version-consistency refusal, exclusive
  arbitration keys). **Migration requirement**: script dispatch goes through
  `config.scriptEnvironmentRungs`. A platform that declares `action:script` as supported must
  list at least one rung with an explicit `execPath`, `executionBackend`, and effective
  `scriptEnvironment`; a sealed rung also needs `environmentManifest`. `conform` reports missing
  or malformed rungs as `unverified`. A config that has only the old single `executionBackend`
  continues to fail closed with `CAPABILITY_UNAVAILABLE`; the runner never guesses an execution
  path. A platform without an isolated script environment may keep `action:script` as
  `declaredAbsent` with a remediation path and integer-minute cost. Keep host execution on the
  consented rung; do not silently map a legacy backend to `host-controlled`.
* **`runtime-contracts 1.2.2`** - `execution.rigor/gated/frozen/execPath/hostConsent` in the
  v1.2 lock, the legal "no sealed script environment" lock shape, and `handoff-bundle/v1`.
  `state` rule 2 gained a narrowing exception only (a `prepared` state may carry completed
  stages only when it names the run and bundle it was imported from).
* **`platform-conformance 1.2.0`** - one `conform` command that computes the three-repo
  capability union centrally and prints pass / `declaredAbsent` / unverified with digests;
  every gap must carry a remediation path and an integer-minute cost.

Corrections to the historical paragraph below, which was written on 2026-09-05 and
kept only as a dated ledger:
* **`wf-runner` is implemented** - it is the shared runner engine, registered with
  `kind: engine, invocable: false` and therefore excluded from the invocation matrix
  denominator by ENTRY-04 (a design exception, not a gap).
* **`repo-lint` current is 0.3.0**, not 0.1.1. `0.1.0` was withdrawn as a scanning
  default after a false missing-file finding and stays an immutable published
  generation with its evidence; `0.1.1`/`0.1.2`/`0.2.0`/`0.2.1` were successive
  defaults, none deleted.
* The `repo-lint@0.2.1` cell is not a platform capability gap either: on platforms
  that declare `scannerRelease=repo-lint/0.3.0` it is a **version-alignment exception**
  (engine defect 3 closed in 0.7.7 - the explicit request is now refused with
  `VERSION_CONFLICT` before anything is written, instead of being silently rewritten).
* Governance tooling is split across two packages. `architecture-ops` owns the platform-scope
  default switch (`switch_defaults` - it deliberately never writes a shared `current.json`),
  version-impact analysis, and since 1.1.0 **the acceptance harness itself**
  (`architecture_ops/invocation_matrix.py`: `--config` required, no platform defaults, per-invocation
  run stamps, `--out` parents created, `--print-digest` to pin which judge measured you).
  `platform-conformance` owns the machine-checkable suite; since 1.1.0 it also recomputes every
  `descriptor.evidenceBindings` digest from disk (CON-04), so a declaration that goes stale fails
  instead of describing a configuration that no longer exists. Run it as
  `python -B -m unittest discover -s conformance -t . -p "test_*.py"` from the release directory
  (`-t .` is required; the 1.0.0 command without it dies on relative imports - D-20).
* Published-directory integrity: a release's `SHA256SUMS` is supposed to cover the directory two
  ways. `platform-conformance/versions/1.0.0` shipped with five unlisted `__pycache__` files, which
  is why the 2.0-X publish step refuses to seal any tree with unlisted bytes (D-28).

## Historical snapshot (2026-09-05, superseded - kept for provenance)

The registry contained 24 Workflows (20 game-*), eight Skill catalogs covering
1,775 Skill directories, and eight Packs. Existing Workflow manifests use v1/v2.
The math Workflow was 1.5.0; visualization-qa 1.1.0; the math Agent 1.6.0 in the
separate Agent registry locked Workflow 1.5.0. Do not confuse these versions.

Implementation and freeze decisions: `E:\ai\agentic-workflow-master-manual.md`
(the 2026-09-07 draft plan formerly under `inbox\workflow-archive-20260907\` was retired on 2026-09-30).
Resolution contract and current implementation limits: `_registry\RESOLUTION_CONTRACT.md`.
The user explicitly started Phase 0 and required a stop after each phase.
Phase 0 is complete; subsequent phases await a new instruction. Only repo-lint's
initial pointer and registry entry changed; existing business defaults and bridges did not.
Release documentation: `repo-lint\versions\0.1.1\README.md`.
Completion evidence: `E:\ai\codex\runtime\runs\20260905-phase0\reports\phase0-completion.md`.

The prior audit found six unlisted bytecode files in math Workflow 1.5.0 and 16
root-level items outside versions/current.json. They remain untouched. A matching
SHA256SUMS list does not prove complete directory coverage. Classify historical
metadata scripts and source snapshots before proposing migration; do not execute them.

## Scenario releases (architecture 3.1.0, 2026-09-23)

A domain is now **one expert + one general workflow + N scenario skills**. What that means for this repo:

- `workflow.yaml` may declare `schema: ai-workflow-definition/v3`, which adds exactly three top-level keys:
  `defaultScenario` (required), `requiredStages`, `scenarios`. The stage item is byte-identical to v2 -- the v3
  schema is derived from the v2 file, so a stage means the same thing in both generations. Vocabulary and the
  machine checks that enforce it: `E:\ai\invocation-adapters-spec.md` §11.
- A workflow that wants its scenarios to change what the model reads must declare those skills under
  `dependencies.skills` in `manifest.json` (exact `skill@semver`). A scenario may only select from that set;
  the run pins the effective set as `execution.contextSkills` and freezes the expansion as
  `execution.expandedGraphSha256`.
- `dependencies.packs` is a set of skills, not a document: packs carry `skillIds` / `skillVersions` and no body,
  so referencing one contributes its members (that is what "actually used" means here) and never any prose.
- Collapsing several workflows into scenarios must not invent a new capability item. Measured lesson (D-80): a
  hand-written permission triple that no source workflow declared pushed `declaredAbsent` from 1 to 2 for every
  platform. Copy the source declaration; the battery rule is that collapsing never grows `declaredAbsent`.
- Deprecation is a registry description (`deprecated` + `supersededBy`), not `enabled: false` -- the latter is a
  hard switch and refuses to resolve pinned older runs. Published `versions/` directories are never rewritten;
  a collapsed workflow keeps its bytes and stays resolvable.
- Added a scenario? The single-cell smoke is `conform --only <id>` (0.1 s; an unknown id now exits non-zero
  instead of reporting an empty pass). `repo-lint --select` does not yet narrow its scan (D-82).

## 当前状态更正（2026-09-23，3.1.0 采纳收口）

共享默认已切换到 `wf-runner 0.10.0`、`runtime-contracts 1.4.0`、`repo-lint 0.5.1`、`architecture-ops 1.3.0`、`platform-conformance 1.4.0`、`visualization-qa 1.3.0`；安全工作流修复释放为 `3.0.1`。各平台的 bridge 配置由本轮统一对齐，平台能力矩阵仍须按各自证据维护。
