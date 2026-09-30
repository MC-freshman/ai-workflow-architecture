# Doubao 平台章

> 维护者：仅 doubao 会话改本文件。

> **〔2026-09-23 架构 3.1.0 采纳（3.1-D 接入轮）〕** 本平台正式采纳架构 3.1.0 三件同代：`wf-runner 0.10.0` + `runtime-contracts 1.4.0` + `repo-lint 0.5.1`。本轮在本平台真实跑通全量 invocation 矩阵、conform 能力地板与 F-1/F-2 新能力实测（读数见下，均为本平台自己出证，不互抄）。software 软件仓按用户 2026-09-23 授权本轮不接入（见「软件面」）。

> **〔2026-09-22 治理口径更正（历史，仍有效）〕** ① 数模与其它 agentic workflow 等同，`math-solver-chain` 不再是各平台需声明的能力项，环境需求按 BP-1 §1.6 三选一归属。② 跨平台资源仲裁自 09-22 起从必需项撤销：续跑只需「版本一致性校验 + 带 sha256 的可回读交接载体」两项，平台内锁表即正确形态；代价明写（同一项目被两客户端同时开工不会被发现、会互相覆盖）。③ 判据 harness 现行路径是 `tool/architecture-ops/versions/1.3.0/architecture_ops/invocation_matrix.py`。

总框架：[../../HANDOFF.md](../../HANDOFF.md)；架构基线：[../../versions/架构3.1.0.md](../../versions/架构3.1.0.md)；接口与判据：[../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §8 / §9 / §10 / §11。

## 状态

**第 6 运行平台**（2026-09-16 升格；2026-09-23 采纳架构 3.1.0）。接入判据仍是规范 §8 的机械验收：**全量 invocation 矩阵 `PASS 38 / NEEDS-INPUT 1 / EXPECTED 2 / FAIL 1`，42 行**（`../runtime/matrix-smoke/doubao-31-final-20260923.json`）。38 个业务资源经 `/wf` `/wfa` 语义 prepare/claim/stop 全部成立；4 个非绿行逐条说明（见下），其中唯一 FAIL 是**共享侧字节缺陷**（workbuddy 同日实测同样 FAIL），非本平台接入问题。

钉版（本平台自决，不动共享默认）：引擎 `wf-runner 0.10.0`、契约 `runtime-contracts 1.4.0`、扫描器 `repo-lint 0.5.1`（三件同代，引擎拒绝半切换，D-52）、环境 = 本平台自建 Windows venv（`../runtime/py-env`，python 3.9.13，满足 runner python>=3.9；0.10.0 requirements.lock 8 库逐版本匹配 + matplotlib 3.9.4/numpy 1.26.4 供 renderer profile；逐包版本见 `environment.json`）。

**能力地板（conform 1.4.0）**：25 items，pass 20 / declaredAbsent 5 / unverified 0 / remediationMissing 0，`floorReached=false`（因本平台无密封脚本环境与 peer，属平台既有形态）。报告：`../runtime/maintenance/3.1-adoption/baseline/floor-final.json`。

## 与 §9 接口逐项对照

| §9 项 | doubao 状态 |
|---|---|
| `platform` / `platformRoot` / `toolRoot` / `agentRoot` / `runsRoot` | ✅ `bridge/doubao-config.json`；共享仓库只读，产物只落 `../runtime/` |
| `runner` / `contracts` / `scannerRelease` 显式版本路径 | ✅ 0.10.0 / 1.4.0 / 0.5.1 |
| `bridge` / `capabilities` | ✅ `../bridge.json`（§9 字段齐备）+ `capabilities.json`（含 ai-platform-descriptor/v2） |
| `capabilities.checks` | ✅ 11 项全 true（原 9 项 + 本轮新增 context-skill-injection、scenario-expansion，均实测） |
| `descriptor.actions.prompt` | ✅ supported=true（enforcement=advisory，会话执行 claim） |
| `descriptor.actions.script` | ⛔ supported=false（无密封环境，见下「脚本面」） |
| `descriptor.actions.peer` | ⛔ supported=false（无 peer dispatcher） |
| `capabilities.profiles` | ✅ `renderer = {adapters:[matplotlib-adapter-first], requires:[matplotlib]}`，venv 内 matplotlib 3.9.4/Agg 出图（`../runtime/renderer-selftest/render.png`） |
| `permissionAdapters` | ✅ 声明业务三元组 project-scoped/deny/allowlisted-only；evidence 写明 prompt 面=会话自律（非内核强制），脚本面不可执行 |
| 传输面（CLI 或 MCP 至少其一） | ✅ CLI（会话执行 runner `cli.py`）；MCP 未注册 → 不声明 |
| 布局 `runsRoot/<run-id>/` | ✅ `run-lock.json`、`state.json`、`events.jsonl`、`commits/`、`transactions/`、`evidence/` |

## 3.1 新能力实测（本平台）

- **F-1 上下文注入**：`visualization-qa@1.3.0` prepare 后 `run-lock.execution.contextSkills=[paper-figure, paper-programmer-visualization, visualization-layout]`，3 个 skill 带双哈希与 resolvedFrom 入锁。
- **F-2 场景展开**：standard / color / export 三场景 prepare，`expandedGraphSha256` 互不相同（`24d1465e` / `186fe77b` / `a116693d`），contextSkills 随场景切换；哈希钉进锁，续跑重算不符即 VERSION_CONFLICT（BP-4 续跑一致性）。
- **档位可见（D-62）**：未写档位锁记 `rigor=balanced`、`rigorSource=default`；无密封环境时 `selection.environment=[]` 为合法锁形态（D-27）。
- **闭环**：prepare → next(claim prompt) → stop 终态 stopped（`doubao-31-smoke-001`）。

## 非绿行逐条说明

| 行 | 状态 | 错误码 | 性质 |
|---|---|---|---|
| workflow `math-modeling-programmer@1.7.2` | EXPECTED | CAPABILITY_UNAVAILABLE（action:script） | 本平台无密封脚本环境，真实缺口 |
| agent `math-modeling-programmer@1.9.0` | EXPECTED | CAPABILITY_UNAVAILABLE（action:script） | 同上 |
| workflow `repo-lint@0.5.1` | NEEDS-INPUT | INVALID_REQUEST | claim+stop 合成参数不满足其输入 schema（scope/report 等 jail 路径）；手动完整参数时走到权限门被 CAPABILITY_UNAVAILABLE（无 shared-read-only 适配器），见 conform gapPlan |
| agent `mastermind-bug-bounty@4.0.0` | **FAIL** | UNAUTHORIZED（definition-mismatch） | **共享侧字节缺陷**，见下 |

**共享侧缺陷（本平台不修）**：`tool/mastermind-bug-bounty/versions/3.0.0/workflow.yaml` 内 `version` 字段写成 `2.0.0`（应为 3.0.0），触发 R2 definition-mismatch；专家 4.0.0 的 toolLock 恰好钉该 3.0.0，严格闭包拒绝其 prepare。3.0.1 目录 yaml 正确。workbuddy 同日 3.1-adopt 全矩阵同一格同样 FAIL（`workbuddy/runtime/maintenance/3.1-adopt/baseline/p3-matrix.json`），证明全平台一致、与 doubao 无关。正确修法＝另立 P 表发布专家 4.0.1（toolLock 改钉 workflow 3.0.1）；属共享 agent 仓发布，超出本轮平台接入授权，不擅自改共享仓。

## 脚本面 / 软件面

- **脚本面（action:script）**：本平台无 WSL/容器密封环境，config 不声明 `scriptEnvironmentRungs`；协议内 script 阶段与 `--tool render-figure / record-visual-review` 不可执行，引擎对脚本派发回答结构化 CAPABILITY_UNAVAILABLE（D-27 闭合形态）。prompt-only 工作流与矩阵 claim+stop 不受影响。
- **软件面（software 仓）**：按用户 2026-09-23 授权本轮**不接入**：config 不声明 `softwareRoot/gateway/interpreters`，6 个软件格不进本平台矩阵分母，conform 中表现为 `union-source-gap:software`（gapPlan 已登记，方向＝连接器/MCP）。不计入本轮接入门槛。

## 入口

| 用法 | 形态 | 状态 |
|---|---|---|
| runner 直调 | `python -B cli.py --config bridge/doubao-config.json --request …` | ✅ 可用（prompt 类阶段；用 `../runtime/py-env` 解释器，设 `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` / `PYTHONDONTWRITEBYTECODE=1`） |
| A4 手册直读 | 读 `tool\<id>\versions\<v>\` 自行执行 | ✅ 可用 |
| `/wf` `/wfa` 命令 | Doubao 客户端无命令配置面 | ⛔ 未注册（以 CLI / A4 直调为入口） |
| MCP 工具面（A3） | 未注册工作流服务 | 不支持（未声明） |

调用手册：[invocation-manual.md](invocation-manual.md)。引擎配置：[doubao-config.json](doubao-config.json)。环境清单：[environment.json](environment.json)。能力：[capabilities.json](capabilities.json)。例外清单：[invocation-exceptions.json](invocation-exceptions.json)。本轮台账：[../runtime/maintenance/3.1-adoption/](../runtime/maintenance/3.1-adoption/)。

## 待办

| # | 事项 |
|---|---|
| D1 | 客户端命令/技能入口（`/wf` `/wfa`）未注册：客户端无命令/插件配置面，以 A4 + CLI 直调为准 |
| D2 | 密封脚本环境未提供：action:script 阶段、数模脚本链与图表工具不可执行；需要时按 BP-1 §1.6 在 doubao/runtime 建平台内环境（约 120 分钟，见 gapPlan） |
| D3 | 共享侧缺陷：mastermind-bug-bounty 专家 4.0.0 因 workflow 3.0.0 yaml version 错误无法 prepare；需发专家 4.0.1（共享侧 P 表） |
| D4 | software 软件仓：用户授权留待，后续按连接器/MCP 方向接入（约 120 分钟） |
| D5 | repo-lint live：需 D04 共享仓只读绑定/只读挂载（约 90 分钟）；pymupdf 钉装（约 15 分钟）随数模能力一并补齐 |

## 明确不做

不改 `tool/`、`agent/` 任何已发布内容与共享 `current.json`（本轮只改本平台 config/capabilities/environment/exceptions）；不改其他平台目录；不 fork 共享契约进平台目录；不把未验证能力写成已具备（负面能力一律进 `declaredAbsent`/`unverified`）；不伪造门禁证据；不把草稿写成已冻结；不擅自为共享侧缺陷发新版本（只登记、点名、建议）。
