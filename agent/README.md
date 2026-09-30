# Shared Agent Registry

Canonical shared Agent registry for every integrated runtime platform
(codex, dsh, workbuddy, zcode, doubao, qoder).

- Architecture basic principles (superior to this file): `E:\ai\versions\架构基本原则.md`
  — BP-1 three-repo skeleton (`tool` + `agent` + `software`) immutable and symmetric /
  BP-2 platform parity + capability floor, authorship confers no runtime privilege,
  conclusions are never copied between platforms / BP-3 acceptance and onboarding minimal
  (adding an agent whose required capability Profile is already declared by a platform
  costs zero platform changes plus one `conform --only <id>` smoke cell) /
  BP-4 one project split into runs across platforms must stay functionally equivalent
  to running it on one platform, which requires a platform-neutral project state layer,
  version-consistency checks on continuation, and cross-platform resource arbitration /
  BP-5 stepwise execution and closure: a plan entering execution is cut into ordered P
  steps of about 2-3 hours each, every P into 2-4 sub-blocks with a safe interrupt point,
  execution follows the approved plan strictly, non-blocking defects found mid-flight are
  logged rather than fixed and get one consolidated fix plan after close-out, and running
  every P step to its pre-written criteria means the update is complete (criteria freeze
  at plan sign-off and are never raised mid-round).

- Registry: E:\ai\agent\registry.json
- Published bundles: E:\ai\agent\<agent-id>\versions\<version>
- Runtime state belongs to the consuming platform, never here.
- Published versions are immutable. Create a new version directory for every change.
- Top-level resolution follows an explicit version, then a platform-local default,
  then the Agent's `current.json`. Record the exact version and source before execution.
  Internal Workflow/Skill/Pack selection must obey the Agent's exact `tool-lock.json`;
  neither a platform default nor an explicit argument may bypass that lock.
- Agent releases contain prompts, domain policies, tests, and a version-locked
  `tool-lock.json`; shared Skill, pack, and Workflow implementations belong to
  `E:\ai\tool`.
- A run may select a profile (for example one game engine), but profile expansion
  must be resolved to exact Skill and Workflow versions before execution.

## Current Status (2026-09-05)

There are 13 Agents with v1/v2 manifests. The math Agent is 1.6.0 and locks math
Workflow 1.5.0. The mastermind shared pointer and registry both select
3.2.1-dsh.1; Codex has a local 3.3.0 default. This intentional override is not
a reason to change the shared pointer.

Complete version inventory and deferred implementation:
`E:\ai\agentic-workflow-master-manual.md` (the three 2026-09-07 draft plans
formerly under `inbox\workflow-archive-20260907\` were retired on 2026-09-30). Existing releases, pointers,
machine registries, and local defaults remain frozen during the competition.
Updating a lock requires a new Agent release; candidate Workflow 1.6.0 would
need a new math Agent release for Agent-mode adoption, provisionally 1.7.0.

peer-lock is a future mechanism. Its design requires exact versions, rejects
unknown peers, and does not allow automatic minor-version following. A historical
multi-Agent run-lock alone does not demonstrate prior authorization or successful execution.

## Experts and scenario selection (architecture 3.1.0, 2026-09-23)

- One domain = one expert. An expert's `tool-lock.json` may now pin a v3 workflow plus the skills its scenarios
  select (`skills` in the lock, exact semver). Selecting a scenario at `prepare` is a top-level `scenario` key on
  the request -- not a parameter inside `input.parameters`, because every workflow's `input.schema.json` is closed
  and adding a key there would mean rewriting 113 published releases.
- The scenario decides **which of the expert's own pinned skill documents reach the prompt**, nothing else:
  versions still come from the lock, the tier still comes from `rigor`, and a scenario never unlocks a tier
  ("未写档位" stays draft).
- `deprecated` / `supersededBy` on a registry row are descriptions for humans and for `repo-lint` R17. The hard
  switch is `enabled`: setting `enabled: false` makes pinned older runs fail to resolve, which is exactly what
  R17 exists to catch. Collapsing six experts into one (security) or eleven workflows into one (game) moved no
  bytes and flipped no pointers.
- A merged expert's release must state where its scenario content came from. When the source expert's prompt was
  four lines and the craft lives in the skills it pins, the scenario selects those skills instead of writing new
  prose -- inventing a `SKILL.md` to make a migration look complete is a defect, not a deliverable.
- Adoption is still per-platform: publishing `wf-runner 0.10.0` + `runtime-contracts 1.4.0` + `repo-lint 0.5.1`
  as one generation did not move any `current.json`, so no expert runs on scenarios until its platform adopts and
  self-certifies that stack.

## 当前状态更正（2026-09-23，3.1.0 采纳收口）

专家默认已切到 `game-builder 1.9.1`、`mastermind-bug-bounty 4.0.0`、`novel-writer 1.5.1`、`software-engineer 1.5.1`、`visualization-engineer 1.7.1`。旧释放目录保持只读；1.9.1/1.5.1/1.7.1 是对历史元数据或哈希完整性的新增修复释放。
