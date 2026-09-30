# runtime-contracts 1.1.0

`kind = contracts`, `invocable = false`. **Not a business workflow — never appears in the `/wf` / `/wfa` denominator.** It is the standalone protocol/schema/validation package that the shared engine and `repo-lint` *reverse-depend on* (resolves F03: contracts no longer ride inside `repo-lint`).

## 1.1.0 相对 1.0.0

仅一处放宽 + 文档同步：`protocol.schema.json` 的 `prepare.target` 允许**省略 `version` 或传入口别名 `current`**（G-A：一句话切换的真实入口修复）；新增 S28–S33 入口版本扩展用例；`resolution.md` 选择规则 2、`compatibility.md` 1.1.0 节、manifest 记录解析顺序。其余文件与 1.0.0 逐字节一致。显式精确版本请求的形状与行为不变。

## 为什么独立

1.0.0 把运行契约封在 `tool/repo-lint/.../contracts` 内，导致：平台升级被迫跟 lint 工具同版本；引擎闭包自指 `workflow:repo-lint`（`runtime_core.py:29-35`、`resolution.py:149-158`）。本包把协议/schema/校验器从 lint 业务解耦，二者各自独立发版。

## 内容

- `contracts/runtime/` — 从 `repo-lint 0.2.1` **逐字节冻结迁入**的 v1 契约：`common / protocol / run-lock / state / event / transaction` schema、`examples/`、独立静态校验器 `validate_contracts.py`（纯静态，不执行/不持久化/不恢复）。
- `contracts/runtime/error-envelope.schema.json` — **v2 新增**统一错误信封（ADR-2）。
- `contracts/runtime/platform-descriptor.schema.json` — **v2 新增**声明式平台描述 + 能力分面，取代 schema 内 platform 枚举（ADR-0/ADR-1，门2）。
- `contracts/runtime/CANONICALIZATION.md` — 规范化 JSON 与哈希规范一。
- `contracts/runtime/PROTOCOL-COMPATIBILITY.md` — 三层版本与 v1/v2 兼容矩阵。
- `contracts/{compatibility,resolution,run-layout}.md` — 迁入的 v1 规范说明。

## 兼容承诺

v1 形状与行为保持不变；v2 为附加。旧 run 仍按锁内原契约解释。本包不依赖 runner 或 repo-lint 实现（无循环依赖）。runner `0.7.0` 与 `repo-lint 0.3.0` 发布时反向钉本包确切版本。

## 校验

发布前运行本包 `validate_contracts.py`（stdlib `unittest`/直接执行，无需 pytest）：正例 bundle 全过、负例逐条命中预期前缀、canonical/strict-json 向量、v1.2 扩展边界、historical read-only 分类全绿，且新增 v2 schema 通过 `Draft202012Validator.check_schema`。见 `SHA256SUMS` 与随包验收报告。

## 1.3.0 (staged at 3.0 S-P3b, not published)

Purely incremental over 1.2.2: `ai-run-lock/v1.3` is accepted next to v1.1/v1.2, the stage and task
action sets gain `software-call`, a software task carries `{softwareId, softwareVersion, capability,
arguments, idempotencyKey, evidencePath}` with `evidencePath` under `evidence/software-calls/<n>/request.json`,
and a run that dispatches one must pin `execution.software` - the gateway bytes, and every declared
release with the sha256 of its frozen capability snapshot. The error families gain `SOFTWARE_NOT_INSTALLED`,
`SOFTWARE_DRIFT`, `SOFTWARE_BUSY`, `PROFILE_NOT_DECLARED`, `CONSENT_REQUIRED`, `EGRESS_DENIED`,
`SOFTWARE_CALL_FAILED`. Nothing about a v1.2 lock changed: same required keys, same rules.

S-P5 追加（本代仍未发布时并入）：`event.schema.json` 新增一个事件种类 `software-called`，并把它与
`attempt-failed` 一起排除在 `ai-run-event/v1.1` 文档之外；`common.schema.json` 里 claimed attempt 的
`action` 词表加入 `software-call`（与锁、任务面同一动作词，三处必须同时合法）。既有种类与既有动作的含义一字未改。
