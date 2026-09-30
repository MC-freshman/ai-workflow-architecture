# Acceptance Matrix

Phase 0, 2026-09-05. M8-01 plan. `PENDING` below is a planned case, not a result.
Actual test outcomes and counts belong to the run's `reports` files and candidate
acceptance evidence. Phase 0 does not run any future math/game/peer workflow.

## Phase 0 Required Coverage

| Case | Fixture/input | Expected observation | Steps | Evidence |
| --- | --- | --- | --- | --- |
| C01-A | Valid historical manifest v1 + definition v1 + tool-lock v1 | Supported legacy structure; no fabricated executable actions | M1-03/09 | repo-lint-tests.json |
| C01-B | Manifest v2 + schema-less game prompt definition | Correct legacy classification, not definition v2 | M1-03/09 | repo-lint-tests.json |
| C01-C | Valid candidate schema; unknown schema; malformed/duplicate keys | Valid passes; unknown/malformed rejected deterministically | M1-05/09 | repo-lint-tests.json |
| C02-A | Registry/current/manifest ID or version mismatch; disabled object | Concrete reference error; selected candidate blocked | M1-06/09 | repo-lint-tests.json |
| C02-B | Exact dependency missing, version conflict or kind collision | Dependency path identifies the conflict; no current fallback | M1-04/09 | repo-lint-tests.json |
| C02-C | Legacy math mislabels visualization-qa as Skill | R12 dependency-kind-mismatch; strict candidate blocked; no automatic type conversion | M1-04/09 | repository-health.json |
| C02-D | Old Skill explicitly locked while catalog points to newer version | Validate requested release; do not substitute newer version | M1-04/09 | repo-lint-tests.json |
| C02-E | Pack has unpinned member; parent exact lock; contradictory pack version | Unresolved member blocks selected closure; matching parent resolves; disagreement rejects | M1-04/09 | repo-lint-tests.json |
| C02-F | Asymmetric pack conflict, absent negative target, missing engine profile | Active conflict rejects; exclusion does not trigger dependency discovery; required profile unverified | M1-04/09 | repo-lint-tests.json and repository-health.json |
| C03-A | Digest mismatch, missing listed file, duplicate/unsafe checksum line | Distinct diagnostics and candidate block | M1-07/09 | repo-lint-tests.json |
| C03-B | Correct listed digests plus unlisted cache/extra file | Complete coverage fails; cache retained as governance finding | M1-07/09 | repo-lint-tests.json |
| C04 | Traversal, drive/UNC paths, case aliases, junction/symlink escape | Reject before access beyond allowed scan root; fixture only | M1-06/09 | repo-lint-tests.json |
| C16-A | Failed staging tests or preexisting same version target | No overwrite; no registry/current activation | M7-03/04 | candidate-acceptance.json |
| C16-B | Candidate files become read-only; file/directory access policy fixture | Record effective access and inability/ability to add files accurately | M7-03/04 | release/access-policy evidence |
| C17 | Simulated config replacement failure and concurrent hash change | Restore only transaction-owned changes; never overwrite later edits | M7-05/06 | release/recovery evidence |
| C18-A | Snapshot current/config before and after candidate lint execution | Existing business versions and bridge remain unchanged | M1-02/11, M7 | protected-baseline.json and final protection evidence |
| C19-A | Historical prepared/maintenance records inspected statically | Explicitly not successful or resumable business runs | M6-01/04 | inventory.json and contracts |
| LINT-REPORT | Clean/warning/error/input-failure fixtures | Documented 0/1/2 exit contract and separate candidate blocking/capability status | M1-09/11 | repo-lint-tests.json |
| LINT-READONLY | Scan before/after fixture and real protected package inventory | No package/config/output/cache writes by lint | M1-09/11 | integrity/access and protection evidence |

Use this matrix as requirements, not a claim that every row has already passed.
The Phase 0 completion report must map required rows to actual named tests or
explicit static contract review. Missing dynamic cases cannot be relabeled as
passed based on document review. New fixtures and test output stay in Codex.

## Deferred Cases By Phase

| Case | Observation required | Trigger |
| --- | --- | --- |
| C05 | Concurrent next claims once; repeated submit idempotent; changed payload rejects | Phase 1, M2/M6 |
| C06 | Side effect before state-commit crash -> unknown outcome, no automatic replay | Phase 1, M2/M6 |
| C07 | Stop waits for process termination; late result cannot revive terminal state | Phase 1, M2/M6 |
| C08 | Input/attempt mismatch rejects stale result | Phase 1, M2/M6 |
| C09 | Exit 0 with domain BLOCKED never advances | Phase 1, M2 |
| C10 | Two domain state files disagree -> evidence preserved and blocked | Phase 1, M2/M6 |
| C11 | Correct FREEZE order and JSON digest list; post-freeze mutation fails | Phase 1, M2/M8 |
| C12 | Required gate/visual evidence absent, unsupported or stale blocks | Phase 1 domain gates; Phase 2 generic gates |
| C13 | maxIterations=3 gives at most 4 total attempts, all evidence preserved | Phase 2, M3 |
| C14 | Sprint capacity/dependency/buffer defects rejected | Phase 3, M4 |
| C15 | Unauthorized/unlocked/unsupported peer rejected with zero dispatch | Phase 4, M5 |
| C18-B | Real in-flight old run keeps original versions after activation | Phase 1+, M2/M7 |
| C19-B | Implemented read-only historical adapter, never automated resume | Phase 1, M6 |
| GOLDEN-DIRECT | Old direct vs new direct, same frozen evidence and scoring | Phase 1, M8-03/06 |
| GOLDEN-AGENT | Old expert chain vs new expert chain separately | Phase 1, M8-03/06 |

## Fixture And Evidence Rules

Fixture roots are `E:/ai/codex/runtime/runs/20260905-phase0/fixtures/<case-id>`.
Build a minimal synthetic registry/package there. Corrupt only synthetic or
copied fixture files. Use no production credentials or projects. Do not create
a real link into another platform to prove a write refusal; use a simulated
external root inside the fixture boundary. Preserve failed outputs.

Every result must state case ID, exact tested version/hash, input fixture,
expected/observed diagnostic or status, exit code, and side-effect check. Zero
is a measured value; missing result/cost is null or NOT_COLLECTED. Test success,
static inspection, simulated capability and real business success are distinct.
Stop at Phase 0 completion and await the user's next instruction.
