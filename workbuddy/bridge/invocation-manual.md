# WorkBuddy 平台调用手册

> 维护者：仅 **workbuddy 会话**改本文件。平台章：[platform.md](platform.md)。实施方案：[integration-plan.md](integration-plan.md)。协议与判据：[../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §8 / §9 / §10。
>
> **状态：手册全部条目已生效（2026-09-16 S1–S8 执行完成，矩阵 r3 `PASS 38 / EXPECTED 2 / FAIL 0` 达标）。**

## 0. 一句话

`/wf <workflow-id> [任务描述]`、`/wfa <agent-id> [任务描述]` 是共享调用语法（规范 §8）；WorkBuddy 平台以 **Skill 入口（A2）+ CLI 直调（A4）双通道**实现同一语义：构造 `ai-run-protocol/v1.1` 请求 → 调引擎 `cli.py` → 按 `prepare → next → submit → stop` 推进。

## 1. 环境（本平台钉版；S1/S2 已落盘生效）

| 项 | 值 | 状态 |
|---|---|---|
| 引擎 | `E:\ai\tool\wf-runner\versions\0.6.0\cli.py`（以 `workbuddy-config.json` 的 `runner` 字段为准） | ✅ S2 |
| 契约 | `E:\ai\tool\repo-lint\versions\0.2.1`（以 config `contracts` 字段为准；platform 枚举已含 `workbuddy`） | ✅ S2 |
| 解释器 | `E:\ai\workbuddy\runtime\py-env\Scripts\python.exe`（python 3.9.13，对齐 doubao 验证基线；逐包版本见 `bridge\environment.json`） | ✅ S1 |
| 配置 | `E:\ai\workbuddy\bridge\workbuddy-config.json` | ✅ S2 |
| 运行根 | `E:\ai\workbuddy\runtime\runs\`（产物**只**落这里） | ✅ |
| 共享注册表 | `E:\ai\tool\registry.json`（工作流）、`E:\ai\agent\registry.json`（专家），**只读** | ✅ |

**必须环境变量**（否则中文乱码或向只读发布目录写 `__pycache__`）：

```
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
PYTHONDONTWRITEBYTECODE=1
```

**本机 shell**：命令一律走 **PowerShell**（本机 bash 不可用——PortableGit shim 的 PATH 未注入，`env/grep/head/ls` 全部 not found）。

## 2. 统一调用语法（与全平台格式一致，要求 1）

两种入口，**同一协议、同一状态机、同一语法**：

```
/wf  <workflow-id> [任务描述]     ← 所有工作流（tool）
/wfa <agent-id> [任务描述]       ← 所有专家（agent）
```

**入口 A：Skill（A2 原型；待 S5 生效）**
- 用户级 Skill：`<local-user-path> `E:\ai\workbuddy\skills\`，复制-校验-启用）。
- 文本与 zcode `plugins\ai-workflow-hub\commands\{wf,wfa}.md` 逐条语义对齐；差异仅三处：平台路径（`workbuddy`）、解释器（平台 venv）、shell（PowerShell）。

**入口 B：CLI 直调（A4 原型）**
1. 会话组织符合目标工作流 `inputSchema` 的 parameters。
2. 写请求文件 `request.json` 到 `E:\ai\workbuddy\runtime\tmp\`：

```json
{
  "schemaVersion": "ai-run-protocol/v1.1",
  "kind": "request",
  "requestId": "any-unique-id",
  "operation": "prepare",
  "runId": "wb-run-20260916-01",
  "idempotencyKey": "wb-key-001",
  "payload": {
    "platform": "workbuddy",
    "parentRunId": null,
    "target": { "mode": "workflow", "id": "game-sprint-plan", "version": "2.1.1" },
    "parameters": { },
    "inputSources": []
  }
}
```

3. 执行（PowerShell）：

```powershell
$env:PYTHONUTF8="1"; $env:PYTHONIOENCODING="utf-8"; $env:PYTHONDONTWRITEBYTECODE="1"
E:\ai\workbuddy\runtime\py-env\Scripts\python.exe -B E:\ai\tool\wf-runner\versions\0.6.0\cli.py --config E:\ai\workbuddy\bridge\workbuddy-config.json --request E:\ai\workbuddy\runtime\tmp\request.json
```

4. 按 `state.stateRevision` 推进 `next`（领取任务）→ 会话执行 prompt 任务 → 产物落 `runsRoot\<run-id>\evidence\<stage>\<attempt>\` → `submit`（completion 含 `stageId` / `attempt` / `inputSha256` / `artifacts`（用 next 返回的） / `outputs`（路径+sha256+size） / `gates`）→ `stop`。
5. 汇报：run-id、状态、output 路径、门禁结果、run-lock 位置。

**专家模式**：`target` 换成 `{ "mode": "agent", "id": "<agent-id>", "version": "<显式版本或省略>" }`；主工作流由该专家 `tool-lock.json` 的 `runnerWorkflow`（或与 agent id 同名的工作流）解析，**调用方不得指定**，显式参数不能绕过 tool-lock。

**版本解析顺序（要求 3 的机制基础）**：工作流/专家 target 的 `version` 三态——① 用户显式给版本 → 用显式版本；② 省略 → 解析共享 `E:\ai\tool\<id>\current.json`（或 `agent\` 下同构文件）的当前默认。**WorkBuddy 配置与 Skill 均不硬编码业务版本号**。

**数模例外（/wfa 特例，与 zcode 一致）**：agent 为 `math-modeling-programmer` 或任务明确是数模时，先按 §7 档位规则与用户确认范围；**交稿级求解器链本平台不承接**（无脚本隔离环境，`action:script` 阶段不可执行），转 **zcode**（比赛备份平台）。草稿/过图级可按本手册执行 prompt 类阶段。

## 3. 操作语义

| 操作 | payload 要点 | 说明 |
|---|---|---|
| `prepare` | `platform` / `parentRunId` / `target` / `parameters` / `inputSources` | 校验版本、依赖闭包、权限策略、profiles；创建 run 目录 |
| `next` | （空，或请求层 `expectedStateRevision`） | 领取当前阶段任务（prompt 或 script） |
| `submit` | completion（见 §2 第 4 步） | 提交阶段产物；`inputSha256`/`artifacts` 必须与 next 返回的 task 一致 |
| `stop` | `reason` | 终态停止，留证据 |
| `status` | （空） | 查状态 |

- 每次写请求带持久 `idempotencyKey` 与 `expectedStateRevision`（`status` 除外）。
- 失败报告 `runId`、阶段、原因与证据；缺必需门禁为 BLOCKED，未知动作/越权拒绝；**失败只汇报证据，不就地补救**，禁止绕过 runner 改写 tool/agent 目录。
- `prepared` 不是成功；缺阶段结果、门禁或终态时只能报告信息不足。

## 4. 换代跟随（要求 3：一句话切换默认）

**机制**：WorkBuddy 不在配置/Skill 中硬编码任何 tool/agent 版本；默认版本永远实时解析共享 `current.json`。因此"默认换代"只有两种情形，用户一句话即可：

**用户话术**：`该 <tool/agent-id> 已经更新，请将默认 tool/agent 设置为新版本`（可在任何接入平台说）。

**会话五步动作**（workbuddy 会话收到上面话术时执行）：

| 步 | 动作 | 判据/留痕 |
|---|---|---|
| ① 盘点 | 读 `E:\ai\tool\<id>\versions\`（或 agent 同构）+ `current.json`，确认用户新版本目录存在、current 当前指向 | 列出旧→新版本号 |
| ② 校验 | 新版本目录 `manifest.json` + `SHA256SUMS` 齐备且逐哈希通过；目录内无缓存/日志混入 | 任一不齐即停，报告信息不足 |
| ③ 切换/跟随 | **情形 A（共享 current 已指新版）**：零配置跟随，本平台无动作 → 直接 ⑤。**情形 B（新目录已发布、共享 current 未切）**：向用户复述"这将切换共享默认、影响所有平台"，获确认后按原子流程更新共享 `<id>\current.json`（旧值备份 + 维护留痕落 `E:\ai\workbuddy\runtime\maintenance\`）；用户若只要 WorkBuddy 单平台生效，则改为在调用时显式传版本（本平台不做私有覆盖文件，避免与共享默认漂移） | A/B 选择与用户确认内容记入留痕 |
| ④ 冒烟 | 对新版本跑一次最小 `prepare → next → stop` | 新 run-lock 中 target 版本 = 新版本 |
| ⑤ 汇报 | 报旧→新、跟随/切换方式、冒烟 run-id | — |

**红线**：情形 B 的共享 current 切换只发生在用户明确发话之后；任何平台默认覆盖不得改共享 current（规范 §3）；运行中的 run 不受换代影响，继续固定原版本（在途 run 不重读 current）。

## 5. 并行与独立性（要求 4；唯一权威 = 规范 §10 结论表）

**可以并行（WorkBuddy 侧语义）**：

| 场景 | 依据 |
|---|---|
| 不同 run 之间（同工作流或不同工作流、tool 与 tool、agent 与 agent） | 每 run 独占目录与独占文件锁，无跨 run 可变状态；**每个 tool/agent 相互独立、互不影响**。WorkBuddy 将在 S7 用 C1/C2 实测自证，不照抄他平台结论 |
| tool 与 agent 混合并行 | 同上（注册表只读 + 逐版本哈希，产物各落各的 runsRoot） |
| 本平台 run 与其他平台 run | 完全隔离（目录、锁、产物互不相交） |

**不可以并行 / 须点明的限制（用户并行前必读）**：

| 场景 | 原因 | 处理 |
|---|---|---|
| 同一 run 并发写 | `Store.lease()` 冲突 → `REVISION_CONFLICT: Another writer owns this run` | 一个 run 一个写者；重试等终态 |
| 单 run 内多阶段 | 契约硬性 `maxParallel=1`，状态只有单个 `activeAttempt` | 按阶段串行推进 |
| 父运行与子运行（委派） | 派发器按序物化并等待子运行终态 | 父等待子 |
| 同一用户项目目录上的两次数学 run | 项目目录由 INIT 创建并被写（C5：契约依据成立、全系统尚未实测） | 不同项目可并行；同项目严格串行 |
| 共享脚本环境内的脚本阶段 | 环境为全平台共享 | **建议串行**（本平台现状：无脚本隔离环境，script 阶段整体不可执行，见 §6） |

## 6. 权限与能力边界（本平台）

- `permissionAdapters` = 业务三元组 `{filesystem: project-scoped, network: deny, process: allowlisted-only}`（38 个业务资源所需；**待 S3 实测声明**）。分面口径如实：prompt 阶段的 network/process 限制是会话自律，WorkBuddy 会话具备网络与任意命令能力，不冒充内核级强制。
- `profiles.renderer` 待 S3 实测（venv matplotlib Agg 真实出图）后声明。
- **无脚本隔离环境**（不做 WSL/容器沙箱）：任何 `action:script` 阶段与 `--tool render-figure / record-visual-review` 不可执行；矩阵 claim+stop 不受影响。`repo-lint` 的 `shared-read-only-platform-report-write` 未声明 → 该资源按例外登记 EXPECTED（候选翻正路径见 integration-plan §0）。
- `peerDispatch` 不声明 → 委派不可用；MCP 工具面未注册 → 不声明（传输面以 CLI + Skill 成立）。

## 7. 数模档位（全平台统一，规范 §3.1）

未写档位 = **草稿**：只做点名范围；不 INIT 已有项目、不重跑求解器、不扫参、不独立验证、不过严图、不冻结。写「过图」才跑非严格 QA；写「交稿」才走该问所需阶段并冻结。非交稿不得称为已验证或已冻结。**本平台不承接求解器链**（无脚本隔离环境）；图 QA/渲染 prompt 类阶段可执行；交稿级转 zcode。禁止用 runner INIT 清空已有项目。

## 8. 矩阵验收（接入判据）

```
E:\ai\workbuddy\runtime\py-env\Scripts\python.exe -B E:\ai\tool\architecture-ops\versions\1.2.0\architecture_ops\invocation_matrix.py  :: 旧路径 zcode\workspaces\... 已于 2026-09-17 删除（2026-09-22 校正） ^
  --config E:/ai/workbuddy/bridge/workbuddy-config.json ^
  --out E:/ai/workbuddy/runtime/matrix-smoke/workbuddy-matrix-<stamp>.json ^
  --exceptions E:/ai/workbuddy/bridge/invocation-exceptions.json ^
  --runs-root E:/ai/workbuddy/runtime/matrix-smoke/<stamp>
```

目标判据：`PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0`，退出码 0。**r3 已达成（2026-09-16，40 行）**——执行方式说明见 platform.md 状态节（沙箱子进程总量限制 → 按 `--only` 分片执行、机械合并，provenance 随报告留档）。共享默认每次换代后重跑矩阵确认无新 FAIL。

## 9. 本平台已知例外（S6 后按实测错误码登记 invocation-exceptions.json）

1. `wf-runner`（基础设施，**设计如此**）：引擎自身，自调用成环，不作为用户可调用工作流。
2. `repo-lint`（**平台能力缺口**）：其权限策略要求脚本环境只读访问共享根；本平台无内核级隔离沙箱，未声明该策略适配器 → 不可调用。候选翻正路径（实测制）见 integration-plan §0。
