# repo-lint 0.1.0

Read-only static inspection of the shared Workflow, Agent, Skill and Pack
registries. No inspected scripts, prompts, skills, metadata utilities or peer
agents execute. Phase 0 publishes a CLI component; existing bridges do not
support its manifest v2.1 and were not connected to it.

## Invocation And Environment

Use Python 3.9 or newer with `requirements.lock.txt` installed in the invoking
platform. The tested environment is Python 3.9.13 on Windows. Generated
dependencies, bytecode, temporary files and reports belong in that platform's
runtime, never under a published version. Run from a platform working directory
with `-B`, `PYTHONDONTWRITEBYTECODE=1`, and platform-local `TEMP`/`TMP`.

Before invocation create an immutable platform `runtime/runs/<run-id>/run-lock.json`
with agent=null, exact repo-lint version/path/source hashes, interpreter/library
versions and inspection configuration. The CLI is an inspector, not a generic
runner, and does not prepare or resume business workflows. The Phase 0 Codex
operator wrapper and all real invocation locks live in Codex, outside this release.

```text
python -B <release>/scripts/repo_lint.py
  --tool-root <shared-tool-root> --agent-root <shared-agent-root>
  --report <platform-run>/repository-health.json
  --markdown <platform-run>/repository-health.md
  [--bridge <own-platform>/bridge.json]
  [--select workflow:repo-lint@0.1.0]
```

`--report` is required. Existing reports are never overwritten. Report targets
physically inside either inspected repository are rejected, including junction
aliases. The operator must choose its own platform output directory; the CLI
does not implement an operating-system sandbox or infer platform ownership.
Command-line options are the supported transport; `input.schema.json` describes
the logical input model, not a JSON-stdin implementation.

## Results

| Exit | Meaning | Caller behavior |
| --- | --- | --- |
| 0 | No relevant errors and no inventory warnings | Static checks passed; runtime remains unvalidated. |
| 1 | Relevant static blockers | Do not accept the selected candidate/closure. |
| 2 | No relevant blockers; inventory contains warnings | Review warnings before acceptance. |

Argument errors also use standard argparse exit 2 but produce no report. Always
check that a schema-valid report exists. `decision.scope` and `blockingFindings`
determine candidate acceptance. With `--select`, global `summary.errors` may
include unrelated legacy defects; repository-level errors still block every
selection. Warnings and findings are retained across the whole inventory.

Reports keep compatibility findings, hash/coverage defects, dependency defects
and runtime capability separate. A `static-pass` does not prove scripts ran,
permissions were enforced, gates passed or a workflow succeeded.

## Rule Coverage

| Rules | Static responsibility |
| --- | --- |
| R1/R2/R4/R13 | Registries/catalogs, canonical pointers, manifest/definition identity, supported schemas and independent platform defaults. |
| R3/R10/R11 | SHA256SUMS format/hashes/complete coverage, duplicate aliases, reparse points, caches and root-level governance. |
| R5/R6/R7 | Legacy/v2 definitions, acyclic stage graph, worker names, prompt anchor pairing and local action files; unsupported future actions block. |
| R8/R9 | Required gate declarations and bounded repair shape, real JSON Schema validity and non-placeholder new contracts. |
| R12/R14 | Exact dependencies and types, consuming lock coverage, selected Pack conflicts/selector coverage, peer-lock format and unvalidated peer capability. |

Legacy manifest v1/v2 is not definition v2. Unknown formats are not implicitly
upgraded. Legacy empty workers or placeholder schemas are warnings; candidate
v2.1 placeholder schemas block. The known math 1.5.0 visualization-qa type
defect remains a blocking diagnostic. No old release is repaired or rehashed.

Input metadata is limited to 8 MiB, depth 100 and 200,000 tree nodes. Duplicate
JSON/YAML keys, non-finite JSON numbers and YAML aliases are rejected. Resource
and stage cycles block. Exact semver permits valid prereleases. Network schema
references are not fetched. Local reference targets are checked for existence
and confinement; nested external schema graphs and arbitrary custom keywords
are not a general schema resolver. No scanned module is imported.

The inventory covers enabled current releases, exact dependencies, supplied
platform defaults and any explicit selection. It is not an exhaustive audit
of every historical version. `_sources` is classified only. File-name checks
are not a secret-content scan, and permission declarations are not capability
proof. Profiles are retained as unverified requirements, not automatically
selected. Future runner integration must resolve these conditions explicitly.

## Verification And Publication

Copy tests to the invoking platform runtime and execute them against the frozen
release. `tests/test_repo_lint.py` builds isolated normal and damaged fixtures;
`contracts/runtime/` contains Phase 0 protocol schemas/examples/static tests,
without a runner implementation. Never create failure fixtures in live shared
repositories. SHA256SUMS covers every release file except itself.

Publish only to an absent semantic-version directory, verify effective read-only
access and complete checksums, test the installed candidate with an isolated
registry, and only then register/activate it. Existing registered business
components, pointers and bridges are outside this component's publication.
For first-publication rollback restore the previous unregistered/disabled
state, preserving the candidate and diagnostic evidence. Access-control owners
and administrators can change permissions; the policy does not claim protection
against a privileged actor or a complete filesystem sandbox.

Source is original Phase 0 project code. PyYAML (MIT), jsonschema (MIT), packaging
(Apache-2.0/BSD-2-Clause), and their transitives are installed separately; no
third-party package payloads or generated dependency directories are bundled.
