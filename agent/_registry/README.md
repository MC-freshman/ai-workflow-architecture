# Agent Registry Metadata

The canonical registry is `E:\ai\agent\registry.json`. Entries reference each Agent's mutable `current.json`; immutable releases live under `versions/<version>` and are verified through `SHA256SUMS`.

Keep this directory for non-runtime registry documentation only.

Explicit Agent selection and platform-local defaults may override the shared
pointer for a run; record that source without changing current.json. As of
2026-09-05, mastermind selects 3.2.1-dsh.1 globally and 3.3.0 by Codex default.
The 13 registered Agents and their locks were frozen pending the post-competition
implementation; the current authority is `E:\ai\agentic-workflow-master-manual.md`
(the 2026-09-07 draft plan was retired on 2026-09-30).
