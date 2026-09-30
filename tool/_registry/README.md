# Workflow Registry Metadata

The canonical tool registry is E:\ai\tool\registry.json.

Each Skill, capability pack, and Workflow must provide a manifest and a
`SHA256SUMS` file. Workflow packages also provide entrypoint and input/output
schemas. Registry entries reference mutable `current.json` pointers; a
platform bridge resolves and pins the complete Agent/Pack/Skill/Workflow set
before execution.

Top-level explicit versions and platform-local Agent defaults may precede current
pointers. Agent-internal resources remain constrained by exact tool-lock versions.
See RESOLUTION_CONTRACT.md for the target contract and the current Codex limits.

Upstream imports are retained under `E:\ai\tool\_sources` as immutable,
hash-bound snapshots. Normalized packages record their source path and license
in `SOURCE.json`; runtime output never belongs in this registry directory.

Historical import/publish/repair/validation scripts already exist here. Their
presence does not authorize execution or migration. Phase 0 repo-lint 0.1.1
classifies them separately from versioned packages and source snapshots, without execution.
New maintenance tools, staging, dependencies, reports and backups belong to the
maintaining platform. New executable normative schemas must be pinned within a
published release; mutable metadata may index them but must not redefine an active run.

Implementation and freeze status: `E:\ai\agentic-workflow-master-manual.md`
(the 2026-09-07 draft plan was retired on 2026-09-30).
Phase 0 added only repo-lint to registry.json (revision 7 to 8). Its current is
0.1.1; withdrawn 0.1.0 remains immutable. Normative lint and runtime contract
schemas are pinned under `E:\ai\tool\repo-lint\versions\0.1.1`, not here.
Existing business pointers and bridge configuration did not change. The current
phase is complete and paused; no later implementation phase is authorized.
