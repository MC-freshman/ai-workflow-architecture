# Tool Hub Resolution Contract (2026-09-05)

The compact `E:\ai\tool\registry.json` contains eight `skill-catalog` entries,
eight Pack entries, and Workflow entries. Skill catalog entries use `path` and
are sharded by source so a bridge can read one catalog below its bounded-file
limit. The full audit catalog remains in `E:\ai\tool\_registry\skills.json`.

This is the required resolution contract for new execution paths. Existing
bridges may implement only part of it; implementation limits are listed below.
Implementation timing and freeze decisions are defined in
`E:\ai\agentic-workflow-master-manual.md` (the 2026-09-07 draft plan was retired
on 2026-09-30).

## Required Resolution

1. Validate the calling platform, its bridge configuration and allowed runtime
   root. Snapshot the configuration and registry inputs used for resolution.
2. For a top-level Agent, select an explicit version, then a platform-local
   default, then the shared current pointer. For a direct Workflow, select an
   explicit version, then current. Validate the immutable manifest id/version.
3. In Agent mode, read the exact `tool-lock.json`. Internal Workflow, Skill and
   Pack selection must obey that lock; explicit arguments cannot bypass it.
   Expand Packs, Profiles and dependencies to a conflict-free exact closure.
   Direct Workflow mode must also resolve its declared dependency closure.
4. Verify release hashes, complete checksum coverage and path boundaries.
   Resolve interpreter, validation libraries and renderer dependencies to exact
   versions; a version range is not a final run lock. Historical explicit
   versions must be validated without silently substituting current.
5. Validate the effective permission ceiling and supported platform capabilities.
   Unknown required actions, tools, permissions or gates block execution.
6. Write the fully expanded set, resolution sources, configuration/release hashes,
   dependency versions and input hash to the
   consuming platform's `runtime\runs\<run-id>\run-lock.json`.
7. Only then execute stages and load Skill text on demand. Do not reread
   `current.json` or recompute locked versions during execution. Track stage
   status and append evidence without changing fixed version fields.

Resolution sources distinguish explicit, platform-default, current, tool-lock
and future peer-lock selection. A deliberate local default is not shared
registry drift. A future peer-lock accepts exact versions only; no automatic
minor-version following is allowed.

## Current Codex Implementation

As of 2026-09-05, E:\ai\codex\bridge\server.mjs resolves top-level versions,
verifies files listed in SHA256SUMS, writes ai-run-lock/v1 with prepared status,
and returns a model-orchestrated plan. Agent mode also resolves resources listed
directly in tool-lock. Direct Workflow mode records an empty dependencies array.

The current implementation does not establish the full recursive Pack/dependency
closure, comprehensive input-schema and runtime-permission enforcement, generic
stage/gate execution, or directory checksum coverage required above. Its Skill
resolver can reject a requested historical version when a catalog version differs;
future compatibility work must test this case rather than assume old-version replay.
These are documented gaps, not changes made to the bridge during this task.

The existing math entries explicitly use Workflow 1.5.0, or Agent 1.6.0 locked
to that Workflow. They already create a run-lock, so handwritten locks are not
the normal path. Prepared means the plan was returned, not that it succeeded.
Historical v1 records without terminal evidence are display-only, not resumable runs.

## Compatibility and Maintenance

Legacy bridges that only understand Workflow entries remain compatible with the
existing `workflows` section. They do not automatically gain full Skill loading,
dependency expansion or permission enforcement. New capability claims require
implementation and tests; a new bridge field alone is insufficient.

Read existing Agent/Workflow manifests and tool-lock v1/v2 according to their
actual schema. Publish new machine-readable contracts within immutable versions;
this mutable document may explain or index them, but must not redefine an active run.
Use mature YAML/JSON Schema parsers with platform-owned pinned dependencies.

Documentation maintenance records such as ai-maintenance-run-lock/v1 explicitly
set Agent/Workflow to null, contain inventory snapshots, and are excluded from
business execution/recovery. All implementation phases remain deferred until
after the competition and an explicit user start.
