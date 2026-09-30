# Golden Baseline Selection And Evaluation Protocol

Phase 0, 2026-09-05. M8-03 protocol only. Status: PROTOCOL_READY;
baseline selection, execution and comparison remain NOT_STARTED for Phase 1.
No business sample has been certified and no scores or successful outputs are
claimed here. Existing run-lock metadata alone does not qualify a golden sample.

## Two Independent Comparisons

| Chain | Old baseline | Candidate | Required separation |
| --- | --- | --- | --- |
| Direct | math-modeling-programmer Workflow 1.5.0 via existing direct entry | Exact clean Workflow candidate 1.6.0 plus exact runner | Direct compares only with direct |
| Agent | math-modeling-programmer Agent 1.6.0, exact Workflow 1.5.0 and locked dependencies | New exact Agent candidate (planned 1.7.0), matching Workflow candidate and runner | Agent compares only with Agent |

Version numbers are candidates until checked for availability. Preserve the
old published packages and original projects. Old cached files are historical
defects, not a waiver for new candidates. Phase 1 must build a clean candidate
from verified source files and require its execution closure to be clean.

## Sample Admission

At Phase 1 start select one small reproducible, authorized math project with
known expected results and enough content to exercise all nine stages. Prefer
an existing competition artifact set if input/code/environment provenance can
be established. Otherwise create an explicitly labeled synthetic project in
the Codex run, then establish the old baseline before comparing the candidate.
Missing source data, code version, environment or gates means NOT_QUALIFIED.

Create a baseline index in the Phase 1 run containing:

- sample ID, authorization/source, original read-only location and copied paths;
- chain kind, old and candidate resource closure with selection sources/hashes;
- exact input bytes/hashes, data schema, known target values and units;
- code/hash, model/spec confirmation, parameters, seed and RNG implementation;
- interpreter path/version, installed libraries, renderer/font environment;
- deterministic instructions, model identity/settings when available, invocation
  timestamps and platform configuration hash;
- frozen scoring rubric/tolerances before candidate output is inspected;
- baseline outputs, stage records, eight figure gates, human review identity,
  FREEZE JSON digest-list validation and outcome;
- duration, calls/tokens/monetary cost only where measurable, otherwise null.

Retain original data and compare copies under distinct run IDs. New math work
and all generated output stay under Codex runtime. Reusing an original project
as an in-place experiment is not an admissible comparison.

## Fixed Evaluation Contract

| Dimension | Rule fixed before the paired runs |
| --- | --- |
| Numeric correctness | For every metric define reference, units, finite-value requirement and tolerances; require abs(new-ref) <= atol + rtol * abs(ref). Domain constraints must also pass. |
| Reproducibility | Repeat a deterministic subset with identical inputs/seed/environment; explain nondeterministic variation. Do not require bitwise equality from uncontrolled model outputs. |
| Process | INIT, AUDIT, SPEC, BASELINE, SOLVE, EXPERIMENT, VALIDATE, FIGURES, FREEZE each has actual inputs/results and correct domain progression. |
| Domain state | project_manifest and stage_state agree; process exit 0 alone cannot override BLOCKED. |
| Figure quality | Separate evidence for figure_contract, source_preflight, render_preview, layout_bbox_qa, composition_efficiency, panel_alignment, pdf_collision, visual_review. |
| Freeze integrity | Advance and confirm domain FREEZE before generating its JSON manifest; verify all listed file hashes and required artifact coverage without modifying frozen state. |
| Human rubric | Grade correctness, completeness, clarity and visual readability each 0-4 using anchored criteria; require correctness/completeness >=3, all required gates pass, and no unaccepted regression vs baseline. |
| Cost/latency | Compare measured values with same inclusion boundary; record model/provider variance and missing metrics, never enter 0 for missing data. |

Rubric anchors: 0 missing/unusable; 1 major defects; 2 material repairs required;
3 usable with only minor issues; 4 fully meets the frozen acceptance contract.
Prefer the same reviewer and anonymized chain labels where practical. Record
review comments before revealing cost data to avoid changing quality judgments.
Default numerical tolerances cannot be invented generically: set them from
the selected model/domain before either comparison and store them in the index.

Run negative cases separately: missing audit, missing SPEC confirmation, domain
state disagreement, missing/stale visual review, invalid frozen hash, and
attempt/input mismatch. Their expected outcome is blocked or failed with no
downstream advancement. A successful golden case does not replace these tests.

## Admission Gate For Phase 1 Acceptance

Both chains have their own qualified baseline, fixed rubric and actual paired
evidence. Numerical/domain thresholds and all eight required figure gates pass;
FREEZE is valid; quality regressions are explicitly resolved before acceptance.
Missing evidence is BLOCKED or NOT_COLLECTED, never PASS. The Phase 1 report must
state which runs were executed and any limitations. This Phase 0 document
defines the protocol and does not claim that gate has been reached.
