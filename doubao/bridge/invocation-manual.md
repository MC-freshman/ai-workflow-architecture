# Doubao 平台调用手册

> 维护者：仅 doubao 会话改本文件。平台章：[platform.md](platform.md)。协议与判据：[../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §8 / §9。

## 0. 一句话

`/wf <workflow-id> [任务描述]`、`/wfa <agent-id> [任务描述]` 是共享调用语法；Doubao 平台当前以 **CLI 直调**实现同一语义：构造 `ai-run-protocol/v1.1` 请求 → 调引擎 `cli.py` → 按 `prepare → next → submit → stop` 推进。

## 1. 环境（本平台钉版）

| 项 | 值 |
|---|---|
| 引擎 | `E:\ai\tool\wf-runner\versions\0.10.0\cli.py` |
| 契约 | `E:\ai\tool\runtime-contracts\versions\1.4.0` |
| 扫描器 | `E:\ai\tool\repo-lint\versions\0.5.1`（platform 枚举已含 `doubao`） |
| 解释器 | `E:\ai\doubao\runtime\py-env\Scripts\python.exe`（python 3.9.13，依赖按 0.10.0 requirements.lock + matplotlib 3.9.4/numpy 1.26.4） |
| 配置 | `E:\ai\doubao\bridge\doubao-config.json` |
| 运行根 | `E:\ai\doubao\runtime\runs\`（产物只落这里） |

**必须环境变量**（否则中文乱码或向只读发布目录写 `__pycache__`）：

```
PYTHONUTF8=1
PYTHONIOENCODING=utf-8
PYTHONDONTWRITEBYTECODE=1
```

## 2. 直调步骤

1. 写请求文件 `request.json`：

```json
{
  "schemaVersion": "ai-run-protocol/v1.1",
  "kind": "request",
  "requestId": "any-unique-id",
  "operation": "prepare",
  "runId": "my-run-20260916",
  "idempotencyKey": "my-key-1",
  "payload": {
    "platform": "doubao",
    "parentRunId": null,
    "target": { "mode": "workflow", "id": "game-sprint-plan", "version": "2.1.1" },
    "parameters": { "entrypoint": "…", "capacityConfig": { "bufferPercent": 30 } },
    "scenario": "standard",
    "inputSources": []
  }
}
```

专家模式把 `target` 换成 `{ "mode": "agent", "id": "novel-writer", "version": "1.5.1" }`；主工作流由该专家 `tool-lock.json` 决定，**调用方不得指定**。v3 工作流可在 payload 加 `scenario`（缺省取 defaultScenario），展开图哈希会钉进 run-lock。

2. 执行：

```
py-env\Scripts\python.exe -B E:\ai\tool\wf-runner\versions\0.10.0\cli.py --config E:\ai\doubao\bridge\doubao-config.json --request request.json
```

3. 按响应中的 `state.stateRevision` 推进 `next`（取任务）→ 写阶段产物到 `runsRoot/<run-id>/evidence/<stage>/<attempt>/` → `submit`（completion 含 `stageId` / `attempt` / `inputSha256` / `artifacts`（用 next 返回的） / `outputs`（路径+sha256+size） / `gates`）→ `stop`。

## 3. 操作语义

| 操作 | payload 要点 | 说明 |
|---|---|---|
| `prepare` | `platform` / `parentRunId` / `target` / `parameters` / `inputSources` | 校验版本、依赖闭包、权限策略、profiles；创建 run 目录 |
| `next` | （空，或 `expectedStateRevision` 在请求层） | 领取当前阶段任务（prompt 或 script） |
| `submit` | completion（见上） | 提交阶段产物；`inputSha256`/`artifacts` 必须与 next 返回的 task 一致 |
| `stop` | `reason` | 终态停止，留证据 |
| `status` | （空） | 查状态 |

- 每次写请求带持久 `idempotencyKey` 与 `expectedStateRevision`（除 `status`）。
- 失败报告 `runId`、阶段、原因与证据；缺必需门禁为 BLOCKED，未知动作/越权拒绝。

## 4. 权限与能力边界（本平台）

- 平台已声明 `permissionAdapters` = 业务三元组 `{filesystem: project-scoped, network: deny, process: allowlisted-only}`（38 个业务资源所需）。`repo-lint` 的 `shared-read-only-platform-report-write/deny/none` 与 `wf-runner` 的引擎策略**未声明** → 按 conform gapPlan 登记（repo-lint 在矩阵 claim+stop 下为 NEEDS-INPUT）。
- `profiles.renderer` 已声明（matplotlib 3.9.4 平台内实测出图）。
- **无脚本隔离环境**：任何 `action:script` 阶段（含数模工作流 1.7.2 / 数模专家 1.9.0）与 `--tool render-figure / record-visual-review` 在本平台不可执行，引擎回答 CAPABILITY_UNAVAILABLE；矩阵 claim+stop 的 prompt-only 资源不受影响。
- **peer 委派不可用**（未声明 `peerDispatcherModule`）。
- **software 软件仓**：按用户 2026-09-23 授权本轮不接入。

## 5. 档位（全平台统一，不再专指数模）

未写档位 = **草稿**：只做点名范围；不 INIT 已有项目、不重跑求解器、不扫参、不独立验证、不过严图、不冻结。写「过图」才跑非严格 QA；写「交稿」才走该流程声明的全部阶段并冻结。非交稿不得称为已验证或已冻结。数模自 2026-09-22 起与其它工作流等同，本平台因无脚本环境只能跑其 prompt 面。

## 6. 矩阵验收

```
py-env\Scripts\python.exe -B E:\ai\tool\architecture-ops\versions\1.3.0\architecture_ops\invocation_matrix.py ^
  --config E:/ai/doubao/bridge/doubao-config.json ^
  --out E:/ai/doubao/runtime/matrix-smoke/doubao-31-<stamp>.json ^
  --exceptions E:/ai/doubao/bridge/invocation-exceptions.json
```

当前判据（2026-09-23，架构 3.1.0）：`PASS 38 / NEEDS-INPUT 1 / EXPECTED 2 / FAIL 1`，42 行；唯一 FAIL 为共享侧字节缺陷（mastermind-bug-bounty 专家 4.0.0，workbuddy 同样 FAIL），非本平台问题。任何共享默认换代后应重跑确认。

## 7. 本平台已知例外（详见 invocation-exceptions.json）

1. `wf-runner`（设计如此）：引擎自身，registry invocable=false，按类型排除。
2. `math-modeling-programmer` 工作流 1.7.2 / 专家 1.9.0（EXPECTED）：含 action:script，本平台无密封脚本环境，CAPABILITY_UNAVAILABLE。
3. `repo-lint`（NEEDS-INPUT）：合成参数不满足输入 schema；手动完整参数时走到权限门 CAPABILITY_UNAVAILABLE（无 D04 只读绑定）。
4. `mastermind-bug-bounty` 专家 4.0.0（FAIL，共享侧）：workflow 3.0.0 yaml version 误写 2.0.0；需共享侧发专家 4.0.1，本平台不修。
