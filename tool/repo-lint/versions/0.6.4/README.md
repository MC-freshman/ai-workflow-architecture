# repo-lint 0.2.1

Read-only static inspection of the shared Workflow, Agent, Skill and Pack
registries. No inspected scripts, prompts, skills, metadata utilities or peer
agents execute. Phase 0 publishes a CLI component; existing bridges do not
support its manifest v2.1 and were not connected to it.

Version 0.1.2 widens the runtime protocol, run-lock and transaction platform enumerations to accept qoder; existing platform inputs stay valid. Version 0.1.1 fixed inspection of legacy Agent policy labels. Version 0.1.0
was withdrawn after the full repository check exposed false missing-file
diagnostics; its immutable release and evidence are retained. Policy labels
are requirements whose enforcement remains unverified. Explicit policy file
references still require existing, confined files.

Version 0.2.1 adds three visibility rules and one downgrade:

- `gate-unverified` becomes `info` (`gate-execution-evidenced`) when the release ships
  `tests/contract.json`, because that file is the release's own gate-execution contract
  test; a bare gate declaration without it still warns.
- `agent-without-main-workflow` warns when an Agent neither declares `runnerWorkflow` nor
  locks a same-named workflow, so runner mode has no main workflow to select.
- `agent-profile-unsupported` warns when a locked profile is outside the pinned runner's
  declarative set, which must be carried in policies until engine 0.6.0.
- `lock-lag` warns when an Agent tool-lock pins a workflow older than the shared default.

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
  [--select workflow:repo-lint@0.2.0]
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
determine candidate acceptance. With `--select`, registry/catalog discovery and
the global R2 identity guard still cover every current pointer, every current
manifest id/version, and every current Workflow definition id/version. Full
release checks, including complete `SHA256SUMS` tree walks, run only for the
selected exact dependency closure and supplied platform defaults. Unrelated
release schema, file, and checksum defects therefore do not add scan cost or
block a single-resource selection; repository-level defects and any global R2
identity mismatch still block it. `summary.resourceCount` and
`summary.checkedFiles` describe the releases/files actually fully audited.

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
| R17 | Prompt-injection budget per Agent and scenario: what the runner would deliver in tokens against a declared `windowProfile`, with the pinned-Pack and unnamed-scenario causes attributed. |

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

## 0.2.0 (2026-09-14)

Version 0.2.0 adds the extension and delegation contract surface without relaxing core validation:

* `x-` extension slots: every closed object schema (v2.1 manifest, v2 definition stages, run-lock, state,
  event, protocol, transaction, common definitions) now accepts `x-`-prefixed properties. Every other unknown
  property remains an error, so closedness still catches typos.
* Rule **R15** records every `x-` field. A field listed in `tool/_registry/x-fields.json`
  (`ai-x-field-registry/v1`) is reported as info; an unlisted field is a warning until it is registered or
  promoted in the next contract revision.
* Rule **R7** now accepts `peer-agent` and `subworkflow` stages conditionally instead of rejecting them:
  `peer-agent` needs a nonempty `peers` array, `worker: none` and an `outputs` schema, and the Agent that
  locks the Workflow must hold an R14 peerLock covering every declared peer; `subworkflow` needs an exact
  resolvable `{id, version}` and the same `worker: none` / `outputs` requirements. Accepted stages stay
  warnings (`peer-stage-registered`, `subworkflow-stage-registered`): syntax is registered, execution still
  needs engine support, and a supplied platform configuration must declare `peerDispatch` or the release is
  blocked with `peer-capability-undeclared`.
* Runtime contracts: `ai-run-state/v1.2` adds the optional `repairLedger` (per-stage `attemptsUsed`,
  `lastFailures`, `exhausted`), `ai-run-event/v1.2` adds the `attempt-failed` event type, and
  `ai-run-protocol/v1.2` adds the `delegate` operation plus the `"repair"` submit reason. Version 1.1
  documents keep their previous strictness: a v1.1 document may not carry the new fields or operations.

## 0.3.0（2026-09-17，zcode 续作会话）
- 新增 `--scope live|snapshot`（必填）：live=扫描平台 D04 声明的只读 jail 挂载 `/shared/tool`、`/shared/agent`（扫描前脚本自做写探针，声明失守即记 R1 阻断）；snapshot=扫描 stage 进 run 工作区 `<work>/snapshot/{tool,agent}` 的副本。报告新增 `scope`、`sharedWriteProbe`、`processExitPolicy` 字段。
- **经 runner 的退出策略**：仅 blockers 使进程 exit 1；warnings 不再使引擎 run 失败（`summary.exitCode` 保留经典 0/1/2 语义，警告明细在报告里）。这是使 repo-lint 可被 wf-runner script 阶段真实执行所必需的行为契约变更，故走 0.3.0 新版本；0.2.1 保持原样、不可变。
- 输入/输出 schema 随 scope 收紧（live 根为 const；report 必须在 `/work/reports/` 下）。

## 0.4.0 (staged at 3.0 S-P3a, not published)

`--software-root` inspects the third shared repository in the same pass and with the same decision:
`registry.json` resolves each recipe, the pointer must use exactly one selection key (`version`) and
must name its `SHA256SUMS`, `available` must equal the `versions/` listing, the release must seal
two ways, and manifest/recipe/selftest are validated against `schemas/software-*.schema.json`.

Two severities, deliberately different: an `error` refuses a publication (a shape that cannot be
trusted), a `warning` registers a finding against bytes that are already published and immutable -
`SOFTWARE_RECIPE_MISSING` (a platformSupport claim with no recipe behind it, C-2), an unfrozen
capability snapshot (C-4: the engine answers `CAPABILITY_UNAVAILABLE`, never "no drift"), a release
without `SOURCE.json`, and a file hash that is not 64 characters (D-40). Passing `--software-new-release`
turns the retroactive ones into blockers, which is how a new or superseding release is gated.

## 0.5.2 (2026-09-23)

`--select <kind>:<id>@<exact-version>` now keeps R2's global identity guard
without walking every unrelated current release's full file tree. It checks
all current pointer identities, manifest id/version pairs, and Workflow
definition id/version pairs, then performs full schema, dependency, and
two-way checksum validation for the selected exact dependency closure and any
supplied platform defaults. Inventory mode remains unchanged. This addresses
D-82's `--select` near-full-snapshot cost while preserving the identity failure
guard. Regression fixtures cover unrelated R3 isolation and global R2 manifest
and definition drift.
