---
name: "game-sprint-plan"
description: >
  Runner-driven sprint planning pipeline (intake → capacity → plan → review).
  Upstream: AlterLab GameForge, MIT, snapshot-2026.08.31. This 2.1.0 copy adds
  stage anchors, explicit-input adaptation, and a computable plan-integrity gate.
version: 2.1.0
---

# AlterLab GameForge -- Sprint Planning Workflow (2.1.0, runner adapter)

**Adapter contract (M4-02).** This version is executed by the workflow runner. The
upstream shell-preprocessing block (`!`git log`` / `!`gh issue list`` / state-file
reads) is **not executed**: its data arrives as explicit inputs (`backlog`,
`milestone`, `designPillars`, `capacityConfig.previousSprints`). When a data source
is unavailable, plan under the "first sprint / conservative" rule instead of
inventing data. `/game-scope-check` is a separate workflow and is never invoked
implicitly — mention it only as an explicit recommendation in the plan output.
No implicit shell, no network, no sub-workflow dispatch.

Upstream invariants kept verbatim below: one goal per sprint; tasks ≤ 1 day;
buffer non-negotiable but applied **once** (the percentage comes from
`capacityConfig.bufferPercent` as an input, never re-deducted implicitly);
dependencies first-class; MoSCoW tiers; velocity honesty.

### Critical Rules (upstream, unchanged)

1. **One goal per sprint.** The sprint goal is a single sentence that defines success. If the sprint achieves this goal and nothing else, it was a successful sprint.
2. **Tasks max 1 day.** Any task estimated at more than 1 day must be decomposed further (max 8 hours in `estimateHours`).
3. **The buffer is non-negotiable — and applied exactly once.** Effective capacity = Σ(availableDays × productiveHoursPerDay) × (1 − bufferPercent/100). The percentage is an input (`capacityConfig.bufferPercent`, default 20; solo mode 30), never a hidden second deduction.
4. **Dependencies are first-class concerns.** Map them explicitly; the critical path determines minimum sprint duration.
5. **Scope tiers enable flexibility.** Must/Should/Could tiers; Must ≤ 60%, Should ≤ 25%, Could ≤ 15% of effective capacity.
6. **Velocity honesty over velocity aspirations.** Use historical completion rates when `capacityConfig.previousSprints` is provided; otherwise plan conservatively.
7. **Align with pillars.** Reference `designPillars` input when provided.

<!-- stage:intake -->
**Stage 1 — Intake (upstream Steps 1, 2, 4, 6).**

Define the sprint goal (one sentence, pillar-aligned, evaluable), decompose into
day-sized tasks, assign MoSCoW tiers, and name the top 3–5 risks with mitigations.

Upstream task format: ID (`SPRINT-001` style), title, description ("done" looks
like), estimate (hours, ≤ 8), owner, discipline (code/art/audio/design/qa/business),
dependencies (task IDs this is blocked by), scope tier (must/should/could).
Discovery spikes are tasks too — schedule them before the work they inform.

**Seal `intake.json`** in this attempt's evidence directory:

- `sprint`: {number?, dates?, durationDays, goal, milestone?}
- `tasks`: list as above; if a multi-person team has tasks without a clear owner,
  put the *reason* into `missing` — do not invent people.
- `risks`: {description, probability H/M/L, impact H/M/L, mitigation, trigger?}
- `missing`: explicit list of information the user must supply (never fabricate).
- `backlogSource`: where the task list came from (explicit inputs or user statements).

Also seal `output.json` = {"summary": "<one paragraph>", "intake": "<path>"} — the
runner validates it against `schemas/intake.schema.json`.
<!-- /stage:intake -->

<!-- stage:capacity -->
**Stage 2 — Capacity (upstream Steps 5, 7).**

Determine how much work the team can actually do. For each member: available days
(minus PTO/holidays), productive hours per day (typically 5–6, not 8).

`effectiveCapacityHours` = Σ(availableDays × productiveHoursPerDay) ×
(1 − `capacityConfig.bufferPercent` / 100). Deduct the buffer **once**, here,
using the input percentage. Do not apply the upstream 20% figure on top of an
input percentage — the input is the single source of truth. Solo mode: the caller
sets bufferPercent (recommended 30).

Velocity: if `capacityConfig.previousSprints` was provided, compute the average
completion rate and calibrate (below 80% → chronically overcommitting; above 95% →
undercommitting). If absent, record `velocity.sprintsObserved = 0` and plan
conservatively.

**Seal `capacity.json`**: {members: [{name, discipline, availableDays,
productiveHoursPerDay}], bufferPercent, effectiveCapacityHours, velocity?, notes?}
plus `output.json` = {"summary": "...", "capacity": "<path>"}.
<!-- /stage:capacity -->

<!-- stage:plan -->
**Stage 3 — Plan (upstream Step 3 + scheduling).**

Map the dependency chains (design → art → code → QA is the canonical game chain),
identify the critical path, and schedule: blocking tasks first; Must tier protected
first, Should second, Could fills remaining capacity; cut Could before Should when
over capacity, and record every cut in `cuts` with a reason.

**Seal `plan.json`**: {assignments: [{taskId, owner, day, order}] (taskId must exist
in intake tasks; owner must be a capacity member), criticalPath: [taskIds], cuts?,
notes?} plus `output.json` = {"summary": "...", "plan": "<path>"}.

Consume only what intake and capacity sealed: read the prior stage outputs from the
evidence artifacts listed in your task; do not re-invent tasks, people, or hours.
<!-- /stage:plan -->

<!-- stage:review -->
**Stage 4 — Review (upstream Output Format + Quality Criteria, made checkable).**

Produce the final Sprint Plan document (upstream format: sprint identity, team
capacity table, task board by tier, dependency map, capacity summary, risk
register, definitions of done) and seal the machine-checkable package:

1. Copy the sealed `intake.json`, `capacity.json`, and `plan.json` from the prior
   stages into this attempt's evidence directory, byte-for-byte.
2. Seal `output.json` = {"sprintPlan": "<full markdown document>", "summary":
   {goal, totalEstimatedHours, effectiveCapacityHours, remainingHours,
   criticalPathLength?, risksNamed?}}.

The runner then runs `plan-integrity` (`scripts/validate_plan.py`) against the
sealed copies. It verifies: task IDs unique; every `dependsOn` reference exists;
dependency graph acyclic; estimates ≤ 8h; tier loads within Must ≤ 60% / Should ≤
25% / Could ≤ 15%; total ≤ effective capacity; effective capacity consistent with
member details and buffer applied exactly once; assignments reference real tasks and
members; no unresolved `missing` information. Violations are repairable;
missing information is not — it must be listed for the user.
<!-- /stage:review -->

<!-- stage:repair -->
Fix the plan according to the latest `plan-check.json` findings — every correction
must correspond to a finding. Allowed: re-estimate with justification, re-tier,
re-schedule, split >8h tasks, rebalance assignments, cut Could/Should with reasons.
Forbidden: deleting Must-Have tasks to dodge capacity, editing the sealed
`intake.json`/`capacity.json` copies, raising `effectiveCapacityHours`, or any
change the findings do not explain. After fixing, rewrite `plan.json`, refresh the
copies, and seal everything again under this attempt. If a finding is
`MISSING_INFO`, list exactly which fields the user must supply — do not fabricate.
<!-- /stage:repair -->
