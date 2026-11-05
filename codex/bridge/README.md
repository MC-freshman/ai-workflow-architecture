# Codex Shared Resource Bridge

Codex uses the shared read-only three-repository surface:

- E:\ai\agent\registry.json
- E:\ai\tool\registry.json
- E:\ai\software\registry.json

Write run locks, logs and outputs below E:\ai\codex\runtime.

Machine-readable bridge settings are in `bridge.json`. Both `workflow` and
`agent-workflow` modes resolve versions from the shared registries and write
run state only below the Codex runtime root.

The stdio MCP entry point is `server.mjs`, launched by `launch.cmd`. Shared
registries are read-only. Codex-local default release overrides are recorded
in `bridge.json`; they do not change the shared `current.json` pointers used by
other platforms.

## Uniform invocation entries

Codex exposes two explicit local Skills:

- `$wf <workflow-id>[@version] <task>` for every registered Workflow.
- `$wfa <agent-id>[@version] <task>` for every registered Agent.

Both include `agents/openai.yaml` UI metadata and should appear in the `$` Skill picker.
The local `workflow-hub` Skill also keeps `/wf` and `/wfa` as compatible message aliases;
those aliases are not custom native slash-menu commands. Every entry uses the same MCP
bridge and `ai-run-protocol/v1.1`; the full procedure, input shape, concurrency rules and
exceptions are in `invocation-manual.md`.

The bridge accepts `ai-agent/v1`/`v2` and `ai-workflow/v1`/`v2`/`v2.1` releases. Agent runs
verify and record the locked Skill, Pack, and Workflow manifests in `run-lock.json`.
Math-modeling calls keep the workspace-wide tiers: omitted means draft, `过图` adds
non-strict figure QA, and `交稿` performs the required nine-stage delivery path. Existing
projects are never re-initialized by the runner.

## Current runner entry (2026-09-21)

Codex explicitly pins `wf-runner@0.9.0`, `runtime-contracts@1.3.0`, and `repo-lint@0.4.0` in `runner-config.json`.
The 3.0 software face is wired through `software/_gateway@1.0.0` and a Codex-owned
gateway configuration; shared `current.json` pointers remain unchanged.
The shared runner pointer remains `0.5.2`; this platform selection does not alter it.
The runner process is launched with bytecode generation disabled and UTF-8 enabled.
The durable request surface is `prepare/next/submit/status/stop`, with separate
execute and seal tools for claimed script stages and immutable evidence.

The desktop MCP process is long-lived. After changing bridge configuration, the
user must reconnect or restart it before the current desktop session can be claimed
to expose the refreshed tools.

## Verified behavior and limits

Workflow and Agent resolution uses an explicit version first, then the matching Codex
default, then the shared pointer. `ai_set_platform_default` validates the release and
its hashes, atomically updates only `bridge.json`, and writes an audit receipt below
`E:\ai\codex\runtime\default-switches`. Existing runs stay pinned and shared pointers
do not change.

ai_run_workflow and ai_run_agent prepare model-orchestrated plans and create
run-lock v1 before returning them. They do not constitute an autonomous runner,
execute the entire DAG, or prove gate completion. A prepared lock is not a
successful result. Normal use of these entries does not require a handwritten lock.

Prompt stages still require the current session to perform the returned task and
submit evidence. A prepared run, a zero script exit code, or a generated PNG is not
by itself a successful workflow. `peerDispatch` is not configured for Codex and
must be rejected rather than simulated as a platform capability.

The 3.0 adoption evidence is kept under the ignored Codex runtime maintenance area.
The current floor still records explicit gaps for peer dispatch, sealed-script evidence,
three environment package-name normalizations, and the administrator profile. Software
snapshots are readable but remain `frozen:false`, so real software calls fail closed
before dispatch with `CAPABILITY_UNAVAILABLE`.

Current implementation status is maintained in
`E:\ai\agentic-workflow-master-manual.md`; remaining gates are tracked in
`E:\ai\post-competition-closeout.md`.
