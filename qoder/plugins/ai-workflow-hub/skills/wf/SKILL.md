---
name: wf
description: 用 /wf <workflow-id> [任务描述] 调用 E:\ai 共享工作流仓库里的任意工作流，按统一 runner 协议（prepare→next→submit→stop）在当前会话执行，运行产物只写 E:\ai\qoder\runtime。当用户说"跑某个 workflow"、"/wf"、"调用某个工作流"时使用。不要在只读问答或平台维护时使用。
---

# /wf — 工作流直调（qoder）

语法与其余平台一致：`/wf <workflow-id> [@version] [任务描述]`。**不得**在此语法上另造平台私有形式。

细则（协议字段、请求体形状、submit 产物规则）以
`E:\ai\qoder\bridge\invocation-manual.md` 为准；本文件只规定入口动作。

## 1. 解析版本（关键：不要硬编码）

1. 用户写了 `@x.y.z` → 用该显式版本。
2. 否则读 `E:\ai\tool\<workflow-id>\current.json` 的 `version`。
   —— 共享默认一旦切换（用户说"这个 tool 已更新，默认设为新版本"即走 `ops/switch_defaults.py`），下一次调用自动跟随；本平台不另设 per-resource 覆盖。
3. 校验 `E:\ai\tool\<id>\versions\<v>\` 存在，且 `manifest.json` + `SHA256SUMS` 齐备。
   共享仓库**只读**：不得在该目录内写任何文件。

## 1.5 用户说"该 tool 已更新，请把默认设为新版本"时

1. **入口本身什么都不用改**：本 skill 每次调用都现读 `current.json`（见 §1），共享默认一换就自动跟随。
2. **换默认是共享仓库动作**，不是本平台动作：走 `ops/switch_defaults.py plan → apply → verify`（只改 `current.json` 与 registry 字段，
   **绝不覆盖已发布版本目录**），plan/报告与备份路径都指到 `E:\ai\qoder\runtime\` 下，不写别平台目录。
   这一步**改的是所有平台共用的默认指针**，必须先拿到用户明确授权才执行；未授权时只做到 plan（只读）并汇报结论。
3. **切完要重跑验收**（基线 §5「切换后必须重跑」），并按需把新版本登记进例外清单；不重跑就不要宣称"已可用"。
4. **专家不跟随**：agent 的 `tool-lock.json` 钉的是**精确版本**，换工作流默认不会改变专家实际跑的那一份；
   要让专家用新工作流，需要发布该专家的新版本（用户或对应会话的动作，不由本 skill 代做）。

## 2. 组织输入

1. 读该版本 `manifest.json` 的 `inputSchema` → 按其 `required` / `additionalProperties:false` 组 `parameters`。
2. 任务描述不足以填出合法输入时**向用户询问**，不要用假数据凑；缺输入被 `INVALID_REQUEST` 拒绝是正确行为。
3. 有项目输入时才用 `inputSources`，`sourcePath` 必须落在 `E:\ai` 内，`snapshotPath` 用未保留的 `inputs/` 前缀。

## 3. 执行

`runId`：`qoder-<workflow-id>-<yyyymmdd-HHMMSS>`（须匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,100}`）。请求文件写 `E:\ai\qoder\runtime\entries\<runId>\`，每个操作换新的 `idempotencyKey`。

```powershell
# 引擎目录取自 E:\ai\qoder\bridge\qoder-config.json 的 runner 字段（本平台钉版），不要把版本写死在本文件里
cd (Get-Content E:\ai\qoder\bridge\qoder-config.json -Raw | ConvertFrom-Json).runner
$env:PYTHONUTF8 = "1"; $env:PYTHONIOENCODING = "utf-8"; $env:PYTHONDONTWRITEBYTECODE = "1"
python -B cli.py --config E:\ai\qoder\bridge\qoder-config.json --request <请求文件>
```

循环：`prepare` → `next`（`reason:claimed` 时按 `task.stageId` 执行）→ 产物落 `evidence/<stageId>/<attempt>/output.json` → `submit`（字段原样取自 `state.json` 的 `activeAttempt`）→ 直到终态；查看进度用 `status`，中止用 `stop` 带 `reason`。

## 4. 必须如实拒绝的情形

- `next` 给出 `action: script` → 本平台**已有**钉版脚本环境（`qoder-config.json` 的 `scriptEnvironment`，WSL2 Ubuntu2204 + 逐文件快照），
  按手册用 `python -B cli.py --config … --execute <runId> [--tool render-figure|record-visual-review] [--review <json>]` 执行；
  失败就报实测错误码（`TIMEOUT` / `EXECUTION_FAILED` / `UNKNOWN_OUTCOME` / `HASH_MISMATCH`），**不得伪造产物、不得改配置绕过**。
  注意两点：figure 工具硬要求"数模 run 已领取 FIGURES 阶段的 prompt"，`process` 类门禁由**主机解释器**跑而不是 WSL（见手册 §2 与 `E:\ai\qoder\runtime\jail-selftest\JAIL-NOTE.md`）。
- `CAPABILITY_UNAVAILABLE` → 读 `E:\ai\qoder\bridge\invocation-exceptions.json` 对照并按实测消息说明；`repo-lint` 的权限策略
  （要只读挂载共享根）在现行隔离控制器下任何平台都兑现不了，属共享侧接口问题，不要为了让它变绿而谎报适配器。
- 数模目标一律先服从 `E:\ai\invocation-adapters-spec.md` §3.1 档位：**未写档位 = 草稿**（不 INIT、不重跑求解器、不扫参、不独立验证、不冻结）。
  本平台已具备钉版科学栈与图 QA/渲染执行面（见 `E:\ai\qoder\runtime\jail-selftest\JAIL-NOTE.md`），数模不再是"一律转走"；
  但**求解链在 qoder 尚无完整演练**，触及求解/交稿面的请求要如实说明"本平台未演练过九阶段全链"，不得借用别平台的演练结论。
- 任何情况下都不得把 `prepared`、锁文件存在或草稿说成"已完成 / 已验证 / 已冻结"。

## 5. 留痕与并发

运行产物（`run-lock.json`、`state.json`、`events.jsonl`、`evidence/`）只落 `E:\ai\qoder\runtime\runs\<runId>\`。不同 `runId` 可并行；同一 run 只有一个写者（并发写即 `REVISION_CONFLICT`），单 run 内阶段严格串行（契约 `maxParallel=1`）。并发结论以 `E:\ai\invocation-adapters-spec.md` §10 为唯一权威。

失败时报告：`runId`、阶段、错误码、证据路径、是否可重试；不回滚、不删除失败 run。
