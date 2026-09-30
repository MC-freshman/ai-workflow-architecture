# ai-workflow-architecture

A **versioned governance system for agentic AI workflows**: 32 workflows, 15 expert
agents and 1,818 skills that run on six different AI client platforms, pinned to
immutable releases, with machine-checkable hashes and per-platform conformance
evidence at every step.

This repository is a **public export** of that workspace — governance text, shared
registries, platform bridge chapters and the docs site. Runtime evidence, software
binaries, credentials and local machine paths are not here (see
[Publication boundary](#publication-boundary)).

| | |
|---|---|
| Current baseline | [`versions/架构3.5.0.md`](versions/架构3.5.0.md) (2026-09-30) |
| Governing principles | [`versions/架构基本原则.md`](versions/架构基本原则.md) — BP-1 … BP-7 |
| Companion GUI | [Architecture Manager](https://github.com/MC-freshman/architecture-manager) 0.3.1 |
| Tracked defects | [`versions/缺陷状态簿.json`](versions/缺陷状态簿.json) — 73 entries, 0 open |
| Size | ~21.5k files, single export commit |

---

## The problem this solves

You have several AI coding clients (Codex, ZCode, Qoder, WorkBuddy, Doubao, …) and
one body of work you want them all to execute: multi-stage workflows with gates,
prompts, schemas and versioned dependencies. Without discipline this decays into
six divergent copies, "works on my machine" evidence, and silent prompt drift.

Three rules hold it together:

**1. Three shared repos, one isomorphic shape.** Every resource — a workflow, an
expert, a software recipe — is stored identically:

```
<repo>/<resource>/
  current.json          # the default pointer; switching = editing one field
  versions/<semver>/    # immutable once published
    manifest.json       # pinned dependencies, entry point, permissions
    SHA256SUMS          # per-file hashes for this exact release
    SOURCE.json         # provenance
    workflow.yaml | prompt.md | tool-lock.json | ...
  _registry/            # index of all resources
```

Nothing else in the system invents a parallel versioning scheme. A run resolves
every resource to a concrete version and writes it to `run-lock.json` before doing
any work — so a run lock recorded months ago still resolves to the same bytes,
because published releases are never rewritten.

**2. Published ≠ adopted.** Cutting a new release changes nothing for anyone. Each
platform opts into a version in its own config, and adoption requires that
platform's own evidence. Pointer switching and version selection are separate
mechanisms on purpose.

**3. Platforms don't copy each other's homework.** Capability parity is computed
once from the shared registries and applied verbatim to every platform. A platform
is "fully onboarded" when it declares **zero** `declaredAbsent` against that
union — and anything it can't do yet is logged as a *time gap* with a cost
estimate, never as "not supported here".

---

## Layout

| Path | What's in it |
|---|---|
| [`tool/`](tool/README.md) | **Shared workflow repo** — 32 workflows, 1,818 skills, 8 capability packs, `runtime-contracts`, plus the governance tooling (`wf-runner`, `repo-lint`, `architecture-ops`, `platform-conformance`) |
| [`agent/`](agent/README.md) | **Shared expert repo** — 15 domain experts (7 marked `deprecated` after the 3.1 domain merge, but their published bytes still resolve), each with a prompt, policies and an exact `tool-lock.json` |
| [`software/`](software/README.md) | **Shared software-recipe repo** — 6 recipes (manifest, capability snapshot, recipe, selftest) + `_connector` / `_gateway`. **No binaries.** Each platform installs its own copy from a recipe |
| [`versions/`](versions/) | Architecture baselines 1.0.0 → 3.5.0, the principles doc, per-round implementation tables, platform onboarding ledger, defect book |
| `codex/` `zcode/` `qoder/` `workbuddy/` `doubao/` `dsh/` | Per-platform **bridge chapters**: capability declarations, runner config, invocation manual, adapter code. Only the `bridge/` surface is public |
| [`docs-site/`](docs-site/) | Docusaurus static site generated from the above (45 curated pages + auto-generated registry reference) |
| [`AGENTS.md`](AGENTS.md) | Workspace rules — the entry point for an AI agent operating in this tree |
| [`HANDOFF.md`](HANDOFF.md) | Human handoff document: current state, dated rounds, open items |
| [`agentic-workflow-master-manual.md`](agentic-workflow-master-manual.md) | Workflow authoring manual (current main entry) |
| [`invocation-adapters-spec.md`](invocation-adapters-spec.md) | The 8-interface contract every platform bridge implements |

## How a run works

Every platform drives the engine through the same four calls:

```
prepare  →  next  →  submit  →  stop
```

`prepare` resolves and locks versions; `next` returns the stage to execute plus its
prompt and argument schema; `submit` validates the result against the stage's
gates and schemas; `stop` closes the run. Stages are `prompt` (an LLM does the
work), `script` (sandboxed Python), `software-call` (dispatch through the
connector) or `delegate` (spawn a child run). Gates are evaluated by
`repo-lint` rules and process gates — a stage cannot self-certify.

Rigor is declared per run, not per workflow: unset = **draft** (named scope only),
`过图` adds non-strict QA, `交稿` runs every declared stage and freezes output.
The tier changes cost, never capability.

---

## Get started

**Easiest** — install [Architecture Manager](https://github.com/MC-freshman/architecture-manager/releases)
and use its in-app wizard: it clones **this repository** as a workspace, validates
the architecture markers, scaffolds a new platform chapter, and runs preflight →
`conform` → the invocation matrix for you.

**Manually:**

```bash
git clone https://github.com/MC-freshman/ai-workflow-architecture.git
cd ai-workflow-architecture

# verify the export is intact
sha256sum -c REPOSITORY-SHA256SUMS

# verify one published release, from inside its version dir
cd tool/wf-runner/versions/0.12.0 && sha256sum -c SHA256SUMS && cd -

# run the engine's own regression suite (needs Python >= 3.9)
python -B -m unittest discover -s tool/wf-runner/versions/0.12.0/tests -v

# build the docs site (needs Node)
cd docs-site && npm install && npm run build
```

Then read, in order:

1. [`AGENTS.md`](AGENTS.md) — what the workspace is and how to behave in it
2. [`versions/架构基本原则.md`](versions/架构基本原则.md) — BP-1…BP-7, the top-level rules everything else defers to
3. [`versions/架构3.5.0.md`](versions/架构3.5.0.md) — the current baseline, and what this generation changed
4. [`HANDOFF.md`](HANDOFF.md) — dated history of every execution round, and what is still open
5. Your platform's `<platform>/bridge/platform.md` + `invocation-manual.md`

> Most of the governance corpus is written in Chinese. The registries, manifests
> and code are English. `docs-site/` renders both.

---

## Checking it yourself

Three commands cover the machine-checkable claims:

| Command | Checks |
|---|---|
| `python -B tool/repo-lint/versions/0.6.3/scripts/repo_lint.py` | Registry/pointer consistency across the three repos, immutable-release rules, definition-vs-manifest drift |
| `python -B -m conformance.conform --config <platform>.json --out floor.json` | Capability floor: pass / `declaredAbsent` / unverified, with a remediation path and integer-minute cost for every gap |
| `python -B tool/architecture-ops/versions/1.5.0/architecture_ops/invocation_matrix.py` | The per-platform invocation matrix — is `prepare→next→stop` actually callable on this client |

Every `SHA256SUMS` is per-release and re-computable; `REPOSITORY-SHA256SUMS` covers
the whole export.

## Publication boundary

**Published here:** governance baselines, the three shared repos, platform bridge
declarations and adapters, the docs site.

**Never published:** platform runtime evidence and maintenance ledgers, software
binaries and their install paths (replaced by `<local-tool-body-path>` /
`<local-user-path>`), credentials (none — verified by a full-history scan at
export time), the inbox.

Re-exports are generated by `scripts/export-governance-public.mjs` in the
[architecture-manager](https://github.com/MC-freshman/architecture-manager) repo
from the private governance HEAD, and record their source commit in
`EXPORT-MANIFEST.json`.

**Dual-use note:** the security workflows and experts here are *definitions* —
prompts, schemas, tool-locks — for publicly available standard tooling. They
contain no exploits and no targets. Use them only on systems you are authorized
to test.

## License

MIT (code) + CC-BY-4.0 (documentation, workflow and agent definitions, baselines).
See [LICENSE](LICENSE).

---

## 中文说明

这是 `E:\ai` 治理工作区的公开导出仓。要解决的问题是：**让多个 AI 客户端平台跑同一套
有版本、可校验、可复现的工作流**，而不是各平台各跑出一份互相抄不动的副本。

三条骨架规矩：

- **三仓同构**（`tool` 工作流 / `agent` 专家 / `software` 软件配方）。每个资源都是
  `registry.json` 索引 + `current.json` 指针 + `versions/<semver>/` 不可变目录 + 逐版本
  `SHA256SUMS`，切默认只改一个字段。任何运行开始时固定 agent / workflow / skill /
  pack / 依赖版本，并写进该平台的 `run-lock.json`。
- **发布 ≠ 采纳**。发新版本不改任何人；各平台在自己的 config 里显式钉版，采纳要有自己的证据。
- **平台对等，结论不互抄**。能力并集由共享侧集中算一次，对所有平台逐字相同；"接入完成"
  的判据是对该并集 **0 个 `declaredAbsent`**。做不到只能记成时间差并附补齐成本，不得写成
  "本平台不支持"。

运行统一走 `prepare → next → submit → stop` 四步；阶段动作分 `prompt` / `script` /
`software-call` / `delegate`；档位（草稿 / 过图 / 交稿）只管开销，不管"能不能用"。

当前代次：**架构 3.5.0**（2026-09-30 定稿）· `wf-runner 0.12.0` ·
`runtime-contracts 1.5.0` · `repo-lint 0.6.3` · `architecture-ops 1.5.0` ·
`platform-conformance 1.5.1` · `software/_connector 1.0.7`。六个平台章（codex / zcode /
qoder / workbuddy / doubao / dsh）接入深度不同，逐条读数见
[`versions/平台接入清单.md`](versions/平台接入清单.md)；缺陷账
[`versions/缺陷状态簿.json`](versions/缺陷状态簿.json) 共 73 条，当前 open 为 0。

上手最快走 [Architecture Manager](https://github.com/MC-freshman/architecture-manager)
的接入向导：它会克隆本仓当工作区、校验架构标记、生成新平台骨架并跑预检 → `conform` → 矩阵。
