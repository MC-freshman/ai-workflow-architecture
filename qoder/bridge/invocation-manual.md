# Qoder 调用手册

> 维护者：qoder 会话。A4（手册直读）与 runner 直调均可用；runner 侧 `prepare → next → submit`（三阶段连续 completed）→ `stop` 已实证，并已通过 §8 矩阵验收（当前判据 **`38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`**，2026-09-15 第五轮；r4 同数，见 [../runtime/matrix-smoke/qoder-matrix-20260915-r5.json](../runtime/matrix-smoke/qoder-matrix-20260915-r5.json)）。**脚本执行面已具备并实测**（本平台自建 WSL2 密封 venv + 逐文件快照，jail 内真实出图，见 §0.5 / §4.5），但**协议内的 `action: script` 阶段至今没有一格实测**（没有可跑目标，不是能力缺失）；`process` 类门禁、peer 委派、MCP 工具面在本平台不可用（缺声明的能力，见 [capabilities.json](capabilities.json) 的 `declaredAbsent`）。本平台钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`；共享指针为 0.5.2 / 0.2.1，本平台钉版不改共享默认。总框架见 [../../HANDOFF.md](../../HANDOFF.md)、架构基线见 [../../versions/架构1.0.0.md](../../versions/架构1.0.0.md)。

## 0. 固定版本口径

每次运行开始先解析并写死：agent 版本、工作流版本、技能/包/renderer/解释器等依赖版本与解析来源。

- 顶层专家选择：显式版本 → 本平台默认覆盖 → 共享 `current`。
- 专家内部工作流与依赖：一律服从精确 `tool-lock.json`，显式参数不得绕过。
- 本平台默认覆盖不改变共享 `current`，且须记录来源与配置哈希。
- 运行中不得重读 `current.json` 自动换版。

`qoder-config.json` 现钉 `tool\wf-runner\versions\0.6.0` + `tool\repo-lint\versions\0.2.1`；共享指针是 `0.5.2` / `0.2.1`——引擎选版与共享默认是两套机制，本平台钉版不动任何 `current.json`。自 0.6.0 变更⑥（契约键按平台钉版取值）起，锁内 `repo-lint` 的 `version` 与 `path`/哈希已自洽；核对历史 run 时仍以 `path` + `manifestSha256` 为准。数模如需承接，先补 [platform.md](platform.md) 的 `renderer` profile 与科学栈缺口（Q2/Q6）。

## 1. A4 直读（现已可用）

1. 读注册表：`E:\ai\tool\registry.json` / `E:\ai\agent\registry.json` → 目标目录 `current.json` → `versions\<v>\manifest.json`。
2. 校验完整性：`SHA256SUMS` 覆盖度与逐文件哈希是两项独立检查。
3. 按 `versions\<v>\workflow.yaml` 的阶段顺序在当前会话执行；prompt 阶段由本会话完成，script 阶段核验实际退出码与产物。
4. 留痕写 `E:\ai\qoder\runtime\runs\<run-id>\run-lock.json`，字段对齐 `ai-run-lock/v1.1`。`qoder` 是现行契约（`repo-lint 0.2.1`）的合法 platform 取值；但 A4 手工运行不经 runner 事务，锁内须注明「手工留痕，未经 runner 提交与门禁校验」，不得冒充 prepared/terminal 语义。

共享仓库根级 `run.py`、`scripts/mcp_server.py` 不是入口，不得调用；执行入口只在 `versions\<v>\` 内。

## 2. runner 协议（prepare / next / submit / stop 已实证）

语义：`prepare → next → (会话完成 prompt | --execute 脚本) → submit → status → stop`。脚本**执行面**已具备（本平台密封 venv + 隔离控制器实测，见 §0.5 / §4.5），但协议内 `action: script` 阶段与 `next → --execute <runId>` 分支**仍无一格实测**（唯一带 script 阶段的 `repo-lint` 在 `prepare` 就被其权限策略拒）。

```powershell
cd E:\ai\tool\wf-runner\versions\0.6.0        # 当前钉版快照；实际执行请取 qoder-config.json 的 runner 字段
$env:PYTHONDONTWRITEBYTECODE = "1"     # 必带：否则向只读发布目录写 __pycache__，触发资源完整性拒绝
$env:PYTHONIOENCODING = "utf-8"        # 必带：否则中文 prompt 按 cp936 落盘，UTF-8 读不回
$env:PYTHONUTF8 = "1"                  # 跑 ops/invocation_matrix.py 验收时必带
python -B cli.py --config E:\ai\qoder\bridge\qoder-config.json --request <请求文件>
```

**0.6.0 的声明式前提**（旧引擎没有）：阶段所需权限三元组必须逐条出现在 `bridge/capabilities.json` 的 `permissionAdapters` 中且**精确相等**（不放宽、不做子集），否则 `prepare` 直接 `CAPABILITY_UNAVAILABLE`；`agent` 模式还要求 `capabilities.profiles` 覆盖其 `tool-lock` 的 profile。qoder 只声明业务三元组、不声明 `renderer`，因此数模与可视化渲染链按声明被如实拒。

请求体形状（`repo-lint 0.2.1` `contracts/runtime/protocol.schema.json`）：

| 操作 | 必需字段 | payload |
|---|---|---|
| `prepare` | `idempotencyKey` | `{platform, parentRunId, target{mode,id,version}, parameters, inputSources}` |
| `next` | `idempotencyKey` + `expectedStateRevision` | 空对象 |
| `submit` | `idempotencyKey` + `expectedStateRevision` | completion（阶段产物与门禁证据） |
| `status` | **省略**（不是置 `null`）`idempotencyKey` 与 `expectedStateRevision` | 空对象（`maxProperties: 0`，带任何键都拒） |
| `stop` | `idempotencyKey` + `expectedStateRevision` | `{reason}`（非空字符串） |
| `delegate` | 仅 `ai-run-protocol/v1.2` 允许；**qoder 不可用** | 见下方"实测注意 5" |

`expectedStateRevision` 取上一次响应（或 `state.json`）的 `stateRevision`，每次成功写操作都会推进；本平台实测序列：prepare→rev 0、next 领取→rev 2、每次 submit +2、stop 后终态（一条四阶段链走到 rev 13）。

### submit 的产物与门禁规则（实测）

- 产物路径必须是 `evidence/<stageId>/<attempt>/output.json`（前缀由引擎按当前阶段推导，错前缀即 `UNAUTHORIZED: Output must be ordered immutable attempt evidence`），多条 `outputs` 须按 `path` 排序。
- 每条记录形状 `{path, sha256, size}`，且**文件必须真实落盘**——引擎逐条复核哈希。
- `output.json` 必须满足该阶段 `outputs` 指向的 schema（不合即 `GATE_FAILED: Stage output does not satisfy its schema`）。
- `payload` 的 `stageId` / `attempt` / `inputSha256` / `artifacts` 必须**原样取自 `state.json` 的 `activeAttempt`**；用 `next` 响应里 task 的 `inputSha256` 会得 `INPUT_MISMATCH: Attempt inputs do not match`。
- 幂等键是 `(platform, runId, idempotencyKey)` 命名空间：同键换内容 → `IDEMPOTENCY_CONFLICT`。每次重试都要换新键。
- 必需门禁：`gates` 须覆盖阶段声明的每个 `gateId`，且 gate 证据的 `inputSha256` / `outputManifestSha256` 要与本次提交绑定。`process` 类门禁（如 `plan-integrity` 要执行 `validate_plan.py`）走**主机 `sys.executable`**、与本平台已建成的 WSL 密封环境无关，而唯一带这类门禁的 `repo-lint` 在 `prepare` 就被其权限策略拒（`Required permission policy has no verified adapter`）→ 至今**无法真实产出该证据**；**不得伪造证据凑通过**，此类工作流在 qoder 不可完成（→ 平台章 Q6）。

其余约束：

- `runId` 用 `<platform>-<用途>-<日期>-<序号>`，须匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,100}`。
- `idempotencyKey` 持久且唯一：同键同请求回放旧响应，同键不同请求拒绝。
- `payload.platform` 必须等于配置里的 `platform`（qoder），跨平台身份直接拒绝。
- `inputSources[].sourcePath` 必须落在 `inputRoots`（当前 `E:\ai`）内，快照路径用未保留的 `inputs/` 前缀。
- 缺必需 gate = BLOCKED；越权与未锁定 peer 由引擎拒绝（错误信封）。**"未知动作"与"未声明 peerDispatch 的 delegate"两类的实际出口与直觉不同，见下方实测注意 5、6。** prepared 与锁文件存在都不等于成功。

实测注意：

1. 失败的 `prepare` 仍可能已建好 run 目录（`mkdir` 在资源解析之前），同 `runId` 重试会得 `UNAUTHORIZED: Run directory already exists`。失败目录留证并换新 `runId` 重试，不要原地覆盖。
2. ~~锁内 `repo-lint` 版本字面量写死~~ —— 结案。逐版核对：该字面量只在 **0.5.0**（`resolution.py:137/139/140`），**0.5.2 已无**（早于 0.6.0 的变更⑥），0.6.0 由解析键取版本（`resolution.py:142` 用 `key[2]`）。本平台钉 0.6.0，实测锁内 `version=0.2.1` 与 `path`/哈希自洽。
3. `ops/invocation_matrix.py` 未显式传 `encoding`，在 cp936 区域会以 GBK 解码引擎的 UTF-8 输出并崩在 `stdout=None`。对策是启动矩阵时带 `PYTHONUTF8=1 -X utf8`，不改他人平台的脚本。
4. prompt 任务的 `allowedTools` 只放 `submit-evidence`；图表类工具仅在脚本阶段 `--execute` 下开放，本平台不可达。
5. `delegate`（peer 派发）只在 `ai-run-protocol/v1.2` 下被契约允许；本平台未声明 `peerDispatch`，而 **0.6.0 引擎根本没有 delegate 分支**：请求过了 revision / 终态 / stopRequested 三道守卫后不匹配任何操作支，落到通用响应里缺 `delegation`，被契约响应规则拦成 CLI 原始回溯（`exit 1`、stdout 空）。实测 `events.jsonl` 无委派事件、`stateRevision` 未动——**无记账、无副作用，但也没有机器可读的拒绝码**。不要把它写成"已自证按能力拒绝"。证据 `../runtime/probes/qoder-peer-dispatch-20260915/PROBE-NOTE.md`。
6. **两类错误出口不一致**：引擎自己抛的 `Rejected` 有规范信封（如二次 `stop` 得 `TERMINAL_RUN`）；被契约 schema 拦下的违规（多余 `idempotencyKey`、未知 `operation`、`status` 带 payload 字段）只打 Python 回溯到 stderr、stdout 为空。自动化调用方须把"空 stdout + `exit 1`"当拒绝处理，别指望解析 `error.code`。


## 3. 数模调用档位

```text
档位：草稿 / 过图 / 交稿
项目：<路径>
范围：只做 Qx（或：只改图 / 只改代码）
求解器：不重跑
实验扫描：不做
```

未写档位 = 草稿。细则与红线以 [../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §3.1 为准；qoder 在科学栈自证前不承接数模业务（[platform.md](platform.md) 附加限制）。

## 4. 复现与证据

### 4.1 现行判据（引擎 0.6.0 + 契约 0.2.1）

| 复现什么 | 怎么做 | 预期 |
|---|---|---|
| 全量可调用性 | `PYTHONUTF8=1 -X utf8 python -B ops/invocation_matrix.py --config E:/ai/qoder/bridge/qoder-config.json --exceptions E:/ai/qoder/bridge/invocation-exceptions.json --runs-root <本平台留证目录>/runs --out <报告路径>`。**三个 flag 都必须显式给**：该 harness 的 `--config` 默认指向 **zcode** 的配置、`--exceptions` 默认指向 zcode 的例外清单，漏传就变成拿别平台口径判 qoder；`--emit-exceptions` 会**写**那份文件，本平台一律不带 | `PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0`、退出码 0；当前留证 `../runtime/matrix-smoke/qoder-matrix-20260915-r5.json`（r4 同数；r1–r3 是脚本环境与 `profiles.renderer` 补齐前的历史，r3 为共享默认换代后的复跑） |
| submit 全链 | 照 `../runtime/probes/qoder-engine060-smoke-20260915/` 下 `*-request.json` 的**形状**重放（intake→capacity→plan 逐段 submit，末段 stop）。注意：留证 run 已是终态，原样重放会撞 `Run directory already exists` / 幂等回放——重放必须换 `runId` 与每个操作的 `idempotencyKey` | 三阶段进 `completed`；错误产物在 review 段得 `GATE_FAILED`；终态 `stopped` / rev 13 |
| 幂等与修订守卫 | `../runtime/reports/protocol-guards-20260915/GUARDS-NOTE.md` 所列用例 | 同键同请求只回放；过期 `expectedStateRevision` → `REVISION_CONFLICT` 且事件链与 state 逐字节不变 |
| 并发与入口解析 | `../runtime/reports/entry-and-parallel-20260915/ENTRY-PARALLEL-NOTE.md` | 不同 `runId` 并发 `prepare` 各自独立锁；同 run 并发 claim → 一个 `claimed`、一个 `REVISION_CONFLICT` |
| 默认换代跟随 | `../runtime/probes/qoder-default-follow-20260915/`（先跑 `PROBE-NOTE.md` 说明的那三步） | `run-lock` 钉到 `current.json` 当时的版本（实测 2.1.1），配置零改动 |
| 委派与错误出口 | `../runtime/probes/qoder-peer-dispatch-20260915/PROBE-NOTE.md` | `delegate` 不可用：v1.1 被契约枚举拦；v1.2 无引擎分支 → 响应契约回溯，无事件、`stateRevision` 不动 |
| 清理后回归（2026-09-16） | ① `python -B ops/doctor.py --platform qoder --out qoder/runtime/reports/20260916-cleanup-inventory/doctor-postcleanup`（只读探测，**必带 `--out`**，默认落 zcode 的 `runtime/staging/doctor`）；② `../runtime/probes/qoder-postcleanup-smoke-20260916/` 的 `prepare → status → stop` 三请求（新 `runId`、新幂等键） | doctor `ok:true`、blockers 与 warnings 均空；run 终态 `stopped` / `stateRevision 2`，`run-lock` 钉共享 `current` 的 `game-sprint-plan 2.1.1` —— 证明删掉矩阵历史 run 树与构建日志未伤及解析链。背景见 `../runtime/maintenance/20260916-cleanup.md` |

### 4.2 历史对照（contracts 0.1.2 / 0.1.1）

- **0.1.2 轮（09-12）**：`../runtime/probes/qoder-integration-smoke-20260912/` 的 `prepare-request-r2.json → next-request.json → stop-request.json`，当时得 `prepared`/rev 0 → `claimed`（intake）→ `stopped`/rev 4、`events.jsonl` 5 条；run 本体 `../runtime/runs/qoder-integration-smoke-20260912-r2/`，结论见同目录 `SMOKE-NOTE.md`。**引擎已换到 0.6.0、契约已换到 0.2.1，该轮只作历史基线。**
- **0.1.1 轮（被拒）**：`../runtime/probes/qoder-integration-probe-20260912/PROBE-NOTE.md`——`contracts` 指回 `versions\0.1.1` 后，`prepare` 在协议校验阶段以 `'qoder' is not one of [...]` 拒绝、退出码 1、不生成 run 目录；说明 0.1.2 候选的唯一必要改动就是 platform 枚举。0.2.x 已把 `qoder` 纳入枚举，0.1.2 随之退役留档。
- 同目录另有失败留证 run `../runtime/runs/qoder-integration-smoke-20260912-r1-blocked/`（仅 `.writer.lock` + `prepare-request.json`，无锁无状态，即「信息不足」形态），未删除。


## 5. 并发适用面（结论以规范 §10 为唯一权威）

本平台不重复 §10 的结论表，只登记**本平台侧哪些行成立、哪些行不适用**，以及证据位置：

| §10 行 | 对 qoder 的适用性 |
|---|---|
| 不同 run 之间可并行 | ✅ 实测（并发 `prepare` 各自独立锁与独立 `run-lock`） |
| 同一 run 并发写不可 | ✅ 实测（`REVISION_CONFLICT: Another writer owns this run`） |
| 单 run 内阶段不可并行 | ✅ 契约硬性（`maxParallel` 恒 1、单 `activeAttempt`），本轮 submit 链逐段推进即为表现 |
| 父运行等待子运行 | ⛔ 不适用——本平台无 `peerDispatch`，委派本身不可用（见 §2 实测注意 5） |
| 共享脚本环境内脚本阶段建议串行 | ⚠️ **环境已具备、暂无实例**：本平台 `scriptEnvironment` 已于 2026-09-15 建成（§0.5），但协议内 `action: script` 阶段无一格实测（无可跑目标）→ 该行按 §10 原样生效，本平台不声称已验证 |
| 同一用户项目目录两次数学 run 不可并行 | ⚠️ **适用但无实例**：`profiles.renderer` 已声明，数模按实测划界承接**图 QA / 渲染 / PDF 审计链**（求解器链不承接，见平台章「数模档位」）→ 一旦同项目发生两次数模 run，此行随 §10 生效；本平台无九阶段演练，§10 亦注明 C5 仍为 `NOT_RUN` |
| tool 与 tool、agent 与 agent 互不影响 | ✅ 实测 + 结构性保证（共享仓库只读、逐版本哈希、产物各落本平台 `runsRoot`） |

要并行跑多个资源：为每个资源起独立 `runId`（`qoder-<id>-<时间戳>`），各自一份请求文件与各自的 `idempotencyKey`；
**不要**复用同一 `runId` 或以同一 `idempotencyKey` 发不同请求。
