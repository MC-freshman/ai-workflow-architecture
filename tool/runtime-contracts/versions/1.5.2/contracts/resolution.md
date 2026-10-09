# Exact Resource Resolution Contract

Phase 0, 2026-09-05. M1-04 closure decisions for the later M2 implementation.
Evidence is static metadata plus read-only bridge source inspection. No
business workflows or profile capabilities were executed in this phase.

## Selection And Provenance

1. Use `(kind, id)` as the resource identity. Agent and Workflow may share an ID;
   untyped names never authorize cross-kind substitution.
2. Select a top-level Agent or Workflow by explicit version, then this platform's
   default override, then shared current. A prepare request may omit `target.version`
   or use the entry alias `current`; the engine resolves it once with that order and
   pins the resolved exact version plus provenance (`explicit`, `platform-default` or
   `shared-current`) into the run lock. An entry selection never follows
   `current.json` afterwards. Validate enabled registration, pointer/manifest
   identity and the exact release.
3. In Agent mode every internal Workflow, Skill and Pack must be allowed by the
   exact tool-lock. An explicit request cannot add permission or override it.
   A Workflow declaration and parent lock must agree on kind and version.
4. Expand all selected Pack skillIds, exact skillVersions, Workflow dependencies,
   Skill requires, profiles and future peer locks. Gather all constraints for a
   `(kind, id)` before accepting the closure. Conflicting exact versions block;
   cycles produce a diagnostic instead of recursive discovery without bounds.
5. Lock the entire closure, dependency files, input snapshot, effective policy,
   interpreter, renderer and installed libraries before business actions. Keep
   each selection source, source file/hash and parent dependency edge. During
   execution read the fixed lock, never resolve current again.

Codex defaults currently declare `mastermind-bug-bounty: 3.3.0` and
`math-modeling-programmer: 1.6.0`. The latter equals shared current but still
has `platform-default` provenance when selected through that path. The shared
mastermind current is `3.2.1-dsh.1`. No shared pointer is changed by these defaults.

## Confirmed Legacy Type Conflict

Workflow `math-modeling-programmer@1.5.0` places both
`visualization-layout@1.1.0` and `visualization-qa@1.1.0` under
`requires.skills`. The first is a registered Skill. The second is a registered
Workflow, has no matching Skill, and is explicitly a Workflow in
Agent `math-modeling-programmer@1.6.0` tool-lock. The workflow manifest's
legacy dependency string list includes both names at those same versions.

Phase 0 repo-lint reports R12 `dependency-kind-mismatch` and blocks strict
candidate acceptance. It preserves the defect; it does not automatically
reclassify the reference, supply a Workflow edge, or claim a working adapter.

A possible Phase 1 historical adapter could define interpretation
`legacy-math-1.5.0-visualization-qa-kind`, limited to that exact package/version,
declaration path and dependency version, with both corroborating files pinned.
Agent mode would additionally require exact parent-lock authorization. Such
an adapter would need implementation and dedicated acceptance before use; if
evidence changed or became ambiguous it would block. New math candidates must
move this declaration to the workflow section and cannot rely on that option.

## Pack And Profile Semantics

| Source | Observed declaration | Resolution consequence |
| --- | --- | --- |
| visualization-quality 1.2.0 | Three skillIds with matching skillVersions | Exact versions are visualization-layout 1.1.0, paper-figure 1.0.0, paper-programmer-visualization 1.0.0; compare with parent locks. |
| Other seven current packs | skillIds without skillVersions | Agent exact skill lock can complete the pack. A direct selected pack requires an explicit, snapshotted preparation resolution. Never silently re-resolve current inside execution. |
| Current agent pack closures | All six agents selecting packs cover every member by an exact skill lock; no observed mismatches | Static closure coverage only. Profiles and permissions still need separate checks. |
| game-core 1.1.0 | conflicts lists all three engine packs | Selecting game-core with ANY of those engine packs conflicts, even if the engine pack does not list game-core back. |
| game-engine-godot/unity/unreal 1.0.0 | Each conflicts with the other two | Multiple engine packs are disallowed. selector:null does not pick one. |
| game-builder 1.3.0 | profiles.engine = required-and-mutually-exclusive, but no selected engine pack/version | Current metadata does not define a satisfiable exact engine selection. Keep the condition unresolved, and when engine selection is materialized report the core conflict. Resolve in a future new package/profile design before game execution. |
| security-audit 1.1.0 | conflicts = [offensive-security] | A negative exclusion is not a dependency to load or install. Retain it; selected matching resource/capability conflicts. An unregistered negative target alone is not a missing dependency error. |
| security-researcher 1.1.0 | profiles.authorization = explicit-required | This is a required runtime authorization condition, not a dependency version or preexisting authorization grant. |
| Math and visualization Agents | profiles.renderer = matplotlib-adapter-first | Adapter preference does not lock a renderer version or demonstrate isolated execution. The selected implementation/environment remains a Phase 1 prerequisite. |

Pack conflicts are evaluated against the active closure, not all unrelated
packs registered in the repository. Keep asymmetric edges meaningful; do not
require both packages to declare the conflict. A profile string is never a
path or executable command. Unsupported required profiles block execution.

All 1,775 current Skill manifests are ai-skill/v1. Their conflicts arrays are
empty. Only visualization-layout 1.1.0 has nonempty requires: python>=3.9,
matplotlib>=3.7, Pillow>=9. These are environment requirements. Math additionally
declares numpy and PyMuPDF; the legacy string `PyMuPDF>=1.24,<2 (strict figure
QA)` contains a comment, so retain/diagnose that spelling rather than handing
it unmodified to an installer. Phase 0 does not install business dependencies.

## Historical Versions And Capability Boundary

The current bridge's Skill resolver compares explicit selection with the
catalog current version and can reject valid historical packages. A future
resolver must validate historical release identity, integrity and authorization
without substituting catalog current. Catalog version describes default
discovery, not permission to change an exact parent lock.

Current bridge source resolves direct tool-lock entries but does not recursively
expand packs, profiles or Workflow/Skill requirements. Direct Workflow runs
currently record an empty dependency array. `prepared` is a returned plan,
not proof of execution. The legacy worker names must not become automatic peer
authorization in the new runner; Phase 1 workers are roles, and peer dispatch
requires Phase 4 permission, exact peer-lock and capability checks.

## Required Parser Cases

Cover kind collisions, historical Skill selection, exact-version disagreement,
unversioned pack members, pack/parent disagreement, asymmetric conflict,
unknown negative conflict target, missing engine profile, unsupported renderer,
unknown schema, duplicate keys, legacy dependency commentary, dependency cycle,
and disabled registration in fixtures. A parser accepting these declarations
as data must not thereby report their execution capability as validated.
