# Schema Compatibility Contract

Phase 0, 2026-09-05. Owners: M1-03 and M1-04. This contract records static
interpretation; it does not certify runtime capability or authorize execution.
Canonical source inventory: `E:/ai/codex/runtime/runs/20260905-phase0/reports/inventory.json`.
All examples remain in their original immutable releases and were read only.

## Dispatch By Schema And Verified Shape

| Object | Actual schema/shape | Verified example | Consumer treatment |
| --- | --- | --- | --- |
| Tool registry | `ai-tool-registry/v2`; separate workflows, packs, skill-catalog references | `E:/ai/tool/registry.json` | Expand enabled catalog references; the full `_registry/skills.json` audit index is not an extra catalog and must not double-count skills. |
| Agent registry | `ai-agent-registry/v2` | `E:/ai/agent/registry.json` | Compare registered ID, pointer ID/version and release manifest. Registry version is revision metadata, not a resource version. |
| Pointers | `ai-workflow-pointer/v1`, `ai-agent-pointer/v1`, `ai-pack-pointer/v1`, `ai-skill-pointer/v1` | Current pointers for the examples below | Validate kind, exact SemVer, ID and target. A prerelease such as `3.2.1-dsh.1` is valid. |
| Workflow manifest v1 | `ai-workflow/v1`; dependency string array and optional runtime block | `math-modeling-programmer/versions/1.5.0/manifest.json` | Distinguish external dependency requirements from exact shared resources. A requirement range is not a locked installed version. |
| Workflow manifest v2 | `ai-workflow/v2`; typed dependency object | `game-code-review/versions/2.0.1/manifest.json`, `visualization-qa/versions/1.1.0/manifest.json` | Accept observed empty arrays and exact maps in their typed sections. Manifest v2 does not imply definition v2. |
| Definition v1 | `ai-workflow-definition/v1`; stage graph, worker names, optional named gates | `math-modeling-programmer/versions/1.5.0/workflow.yaml`; `mastermind-bug-bounty/versions/1.0.0/workflow.yaml` | Validate graph and references; classify as legacy/model-orchestrated, without inventing prompt/script actions. |
| Legacy prompt definition | No schema; `mode: prompt`, `entry: workflow.md`, steps and one execute stage | `game-code-review/versions/2.0.1/workflow.yaml` | Only recognize the documented shape under the supported historical manifest; preserve a compatibility finding. Missing schema elsewhere is not a universal fallback. |
| Legacy evidence definition | No schema; `mode: executable-with-evidence`; descriptive step action strings | `visualization-qa/versions/1.1.0/workflow.yaml` | Preserve the declared steps/gates as data. These action names are not generic runner actions and need Phase 1/2 adapters. |
| Candidate definition | `ai-workflow-definition/v2` | New candidate schema and fixtures only at Phase 0 start | Validate against the candidate's frozen schema. Never interpret a legacy file as this format from its filename or manifest version. |
| Agent v1/v2 | `ai-agent/v1` / `ai-agent/v2` | `mastermind-recon/versions/1.0.0/manifest.json`; `math-modeling-programmer/versions/1.6.0/manifest.json` | Resolve `prompt`, `toolLock` and declared workflows; empty workflow sets are valid. Policies can be historical symbolic labels (for example project-scoped) or explicit local file references (policies/modeling.md). Retain labels as unenforced requirements; check existence and confinement only for file references. Invalid types block. |
| Tool lock v1 | `ai-tool-lock/v1`; exact workflows map, tools array | `mastermind-bug-bounty/versions/3.3.0/tool-lock.json` | Empty tools is valid; nonempty tools require a supported explicit interpretation. No implicit peer permission. |
| Tool lock v2 | `ai-tool-lock/v2`; exact skills/workflows/packs maps, profiles metadata | `math-modeling-programmer/versions/1.6.0/tool-lock.json` | Expand a conflict-free exact closure and record profiles separately from selected versions. |
| Skill catalog / Skill | `ai-skill-catalog/v1` / `ai-skill/v1` | `_registry/skills-math-modeling-skill.json`; `skills/visualization-layout/versions/1.1.0/manifest.json` | Verify catalog, pointer and manifest identity. Explicit historical selection may differ from catalog current but must validate the requested immutable release. |
| Pack | `ai-pack/v1`; skillIds, optional skillVersions, conflicts | `packs/game-core/versions/1.1.0/manifest.json`; `packs/visualization-quality/versions/1.2.0/manifest.json` | Absence of skillVersions is a closure requirement to solve, not permission to use mutable current during a run. |
| Historical run / maintenance | `ai-run-lock/v1`, historical `ai-run-lock/v2`, `ai-maintenance-run-lock/v1` | Existing Codex run metadata | Read-only classification. Schema version, prepared status or a terminal label alone does not certify stage evidence. Maintenance cannot resume as business. |

Workflow/Pack example paths above are relative to `E:/ai/tool`; Agent examples
are relative to `E:/ai/agent`. The inventory records exact sample hashes.
Current schema counts: 2 workflow manifests v1, 21 workflow manifests v2;
7 current agents v1, 6 current agents v2; all 8 current packs v1; all 1,775
current skills v1. Definition counts are 2 named v1, 20 legacy prompt, and
1 legacy evidence definition. The Codex default mastermind 3.3.0 is an
additional v1 agent release, not a fourteenth registered agent.

## Parsing And Validation Rules

Use a pinned YAML parser and JSON Schema validator. Reject duplicate object
keys, malformed roots and unsupported schema identifiers with a diagnostic;
do not silently overwrite JSON/YAML keys. Bound aliases and input size, reject
unsupported custom tags, and do not fetch network schema references. An empty
worker list is valid in legacy serial math stages; it does not supply an action.

Validate referenced input/output JSON schemas as schemas, not merely parseable
JSON. Resolve all file references against the owning package, then verify the
physical target remains within the allowed root. Windows drive forms, UNC,
case aliases, separators, `..`, junctions, symlinks and alternate data streams
must not bypass the boundary. Never import or execute scanned source files.

`SHA256SUMS` is a text digest list. `manifest.sha256` produced by the math
FREEZE script is JSON and belongs to a different domain contract; the filename
suffix must not choose its parser. Digest correctness, complete directory
coverage and access policy are separate results. Published cache files remain
findings even when not listed in SHA256SUMS.

## Report Semantics

Record compatibility status, integrity status, dependency closure status and
runtime capability separately. A supported legacy definition may be readable
but unavailable to a candidate runner. Unknown required actions, profile
semantics or permissions are not PASS. Lint does not execute business work,
install dependencies, repair packages, or remove historical cache.

The observed legacy math dependency defect is described in `resolution.md`.
Phase 0 reports R12 `dependency-kind-mismatch` and blocks strict candidate
acceptance; it does not automatically reclassify or add a Workflow edge. A
narrow historical adapter is a Phase 1 design option only. New candidates
must use correctly typed declarations and exact dependency records.

## 0.2.0 compatibility

| Change | 0.1.1 read | 0.2.0 read | Migration |
|---|---|---|---|
| `x-` extension slots | field rejected | accepted and recorded by R15 | none for existing releases |
| `peer-agent` / `subworkflow` | error | conditional pass (warnings only) | new Workflow releases declare `peers` / `subworkflow` |
| state v1.2 `repairLedger` | n/a | v1.1 and v1.2 both accepted; v1.1 must not carry it | engine writes v1.2 when it maintains the ledger |
| protocol v1.2 `delegate` / `"repair"` | n/a | optional; v1.1 messages unchanged | bridge adapters adopt per platform |

The `delegate` payload and `delegation` result are frozen as syntax only: field changes discovered by the
engine implementation are expected to land as `x-` fields first and be promoted in a later revision.

## 1.1.0 compatibility (entry version resolution)

| Change | pre-1.1.0 read | 1.1.0 read | Migration |
|---|---|---|---|
| `prepare.target.version` | required exact SemVer | optional; entry alias literal `current` accepted | none for existing senders: an explicit exact version validates identically |
| omitted / `current` entry | rejected (INVALID_REQUEST) | valid request syntax | only engines >= wf-runner 0.7.4 resolve-and-pin such requests; older engines keep rejecting them, so a platform must not send omissions before pinning 0.7.4 |

The relaxation is wire syntax only. The engine still resolves exactly once at
prepare and pins the exact version and provenance into the run lock
(`resolution.md` selection rule 2), so the version-freeze invariant is unchanged;
requests persisted inside a run always carry the resolved exact version.

## 1.2.0 - the 2.1.0 generation (additive)

Two things changed in meaning, nothing changed in the older shapes:

1. **A lock may now say what it paid for.** `execution.rigor` is one of
   `fast` / `balanced` / `full`, `execution.gated` says whether gates were actually
   enforced, `execution.frozen` is the deliverable claim, and `execution.execPath`
   names the rung of the script ladder that really ran. Three rules make the
   dishonest combinations unrepresentable rather than merely discouraged:
   `frozen: true` requires `rigor: full` **and** `gated: true`; a fast run may not
   assert `frozen` at all; `execPath: host-controlled` requires `hostConsent`, so a
   downgrade to the host always carries the agreement it was given under.
2. **A lock may now say it has no sealed environment.** `selection.environment` lost
   `minItems: 1`; `execution.environmentSealed: false` must be paired with an empty
   list (D-27). Platforms that do have an environment keep writing what they wrote
   before.

On the wire, `ai-run-protocol/v1.3` allows a `prepare` response to carry the first
claim (`result.task` with `reason: claimed`) - that is what lets `rigor=fast` be one
round trip instead of two. A `claimed` reason without a task is invalid, so a merged
response cannot silently claim nothing happened.

Old engines and old locks stay valid: `ai-run-lock/v1.1` and protocol v1.1/v1.2 are
still accepted, and no existing document is reinterpreted.

## 1.2.1 - the request side of the tiers (additive)

`$defs.prepare` is closed (`additionalProperties: false`), which is the right default but means a sender cannot ask for a tier or grant host consent until those members exist. They now do: `rigor` (fast|balanced|full) and `consent` (`agreement`, optional `grantedAt`). Nothing else changed shape; every document that validated against 1.2.0 validates against 1.2.1, and the two new members stay optional for senders on older engines.

No capability is keyed off `rigor` anywhere in this package. BP-2 fixes the capability floor to be the same in all three tiers, so the only tie-rules that exist are the 1.2.0 lock rules that stop a cheap run from *claiming* more than it proved (`frozen` requires `full` and `gated`). A fast prepare may also answer with the first claim inside its own envelope; that shape is legal only under `ai-run-protocol/v1.3`, so a v1.1/v1.2 sender on a fast run simply gets the two round trips it always got.
