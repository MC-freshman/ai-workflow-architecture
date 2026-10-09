---
name: wfa
description: Run or select a registered E:\ai shared Agent from Codex, including an optional exact Agent version, and set a Codex-local Agent default. Use for explicit $wfa calls and /wfa message aliases. Do not accept a caller-selected Workflow.
---

# WFA — Run a shared Agent

Use the `ai_shared` MCP server and the Codex platform rules in `E:\ai\codex\bridge\invocation-manual.md`.

## Accepted request shape

- `$wfa <agent-id> <task>` uses the Codex-local Agent default, then shared `current`.
- `$wfa <agent-id>@<version> <task>` pins that exact Agent version for this run only.
- `/wfa <agent-id> <task>` is a compatible message alias; it is not a native slash-menu command.
- A request such as `$wfa 将 <agent-id>@<version> 设为 Codex 默认` changes only the Codex-local Agent default after release and hash verification.

## Run procedure

1. Resolve the Agent with `ai_get_agent_release`; reject missing, disabled, malformed, or hash-invalid releases.
2. Use the Agent manifest and exact `tool-lock` to select its main Workflow, Skills, Packs, and dependencies. Never accept or invent a caller-selected Workflow for an Agent.
3. Convert the task to the locked main Workflow input schema. Send `input: {parameters, inputSources}`; each file source must use `{sourcePath, snapshotPath}` and place the snapshot below `inputs/`. Ask for missing required facts instead of inventing them.
4. Call `ai_run_agent`. Omit the Agent version unless the user explicitly pins one.
5. Continue through `ai_runner_request`: `next`, perform only the returned action, seal required artifacts and gate evidence, then `submit`. Include `expectedStateRevision` on mutations and continue to a real terminal or user-input boundary.
6. Report the run id, current or terminal status, exact Agent and dependency locks, outputs, and gates. A prepared run is not a successful run.

For a default change, use `ai_set_platform_default` with `kind=agent`. Confirm `scope=platform-local`, `effectiveFor=future-runs-only`, and `sharedCurrentChanged=false`; report its receipt path. Never edit shared `current.json` or another platform.

Different Agent run ids may execute concurrently. One run remains serial; a parent waits for a delegated child. Codex declares a platform-owned peer dispatcher. Its existing receipt proves child creation and a prompt claim; authored child output remains required and that receipt does not prove completed business work. Execute delegation only through the dispatcher pinned by the current platform config; unavailable or invalid bindings must return a capability error. Cross-platform arbitration is not provided.
