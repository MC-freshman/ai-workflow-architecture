# 管理台与架构对齐 + 缺陷修复（0.8.9，2026-10-28）

目标：让「架构 + 架构管理平台 + 声明需要接入的平台」三者对齐，修掉管理台已登记缺陷，并把新发现的缺陷登记入簿。判据与逐条读数见 `versions/管理台对齐与缺陷修复-P表-20261028.md`。

## 改了什么

| 面 | 文件 | 语义变化 |
| --- | --- | --- |
| Node 发现（D-164） | `src/domains/platforms/management-runtime.mjs` | 拆 `NODE_NOT_FOUND` / `NODE_SPAWN_FAILED` / `NODE_VERSION_UNSUPPORTED`；候选链补 `%ProgramFiles%`、`%LOCALAPPDATA%` 下 `nodejs` 与 `Programs\nodejs`、`where.exe`；逐候选 outcome 记账，spawn 失败不再被当成「没装」 |
| finalize 原子性（D-157） | `src/onboarding-state.mjs`、`src/onboarding-finalize.mjs` | `preflightOnboardingRecorded()` 把前置校验提到 commit 之前；`commitPaths` 只允许「树干净」「已 tracked」两项延后到提交后复验；提交后仍失败 → checkpoint + 审计 + `ONBOARDING_RECORD_INCOMPLETE` |
| 原生验证鲁棒性（D-148） | `src/domains/platforms/native-ai-probe.mjs`、`src/runtime/native_workbuddy.py` | 模型钉扎（`model` / `modelIds` / `modelObserved`，双模型 ⇒ `NATIVE_AI_MODEL_DRIFT`）；`nativeAttemptPolicy` 可配置重试（1–5 次、间隔 0–30s，默认 3 次请求 / 2s）并全部入 attestation；`NATIVE_AI_PROMPT_ECHOED` 把「把工具参数当文本吐出」与真拒绝分开，记为可重试 |
| qoder-cn 管理台侧（D-163 的一部分） | `src/domains/platforms/native-profile.mjs` | 认 `Qoder CN.exe`（带空格）；认 `qoder-cn` 元数据名（vendor 仍 `Qoder`，`edition:'CN'` 仅 CN 形态出现）；跨目录本体报 `NATIVE_BODY_OUTSIDE_PLATFORM:path=…;owner=…` + 两条出路 |
| 一级目录常量（D-165） | `src/inventory.mjs` | `FORMAL_TOP_LEVEL_DIRECTORIES` 补 `qoder-cn`、删从未存在的根级 `ai学习笔记` |
| 文案 | `src/renderer/presenter.mjs` | 新增 `NODE_NOT_FOUND` / `NODE_SPAWN_FAILED` / `NODE_VERSION_UNSUPPORTED` / `ONBOARDING_RECORD_INCOMPLETE` / `NATIVE_AI_PROMPT_ECHOED` / `NATIVE_AI_MODEL_DRIFT` / `NATIVE_ATTEMPT_POLICY_INVALID` / `NATIVE_BODY_OUTSIDE_PLATFORM`；`MANAGEMENT_NODE_REQUIRED` 改为兼容文案、不再叫人安装 Node |

## 新增测试

- `test/management-runtime-node.test.mjs`（7 例）：spawn EBUSY / 非零退出 / 全缺失 / 多候选 + 版本不足 / Electron execPath 形态 + 去重 + target 末位 / plan 载荷形状 + install 不二次发现 / 工作区内异平台目录 out-of-scope。
- `test/onboarding-finalize-atomicity.test.mjs`（4 例）：正常提交并标记完成 / 破坏 binding ⇒ 拒绝且 HEAD 未前进 / 重命名被拒（D-166）/ 未 tracked 治理文件被 defer 而非拒绝。
- `test/native-ai-attempt.test.mjs`（6 例）：策略校验先行 / 钉扎语义 / echo vs refusal / 注入 fake transport 的验证成功路径 / echo 失败形态 / 双模型漂移。**全程不起子进程。**
- `test/qoder-cn-alignment.test.mjs`（4 例）：CN 可执行名发现 / 元数据名映射 / 跨目录本体报错语义 / D-165 双向一致性（含真实工作区校验）。

## 未做 / 待裁定

- qoder-cn **平台目录零改动**：本体归属（迁入 `E:\ai\qoder-cn` 或登记外部本体例外）属治理裁定，本轮不代裁；「外部本体例外」当前未开放，报错里已写明。
- D-166（治理文件重命名卡 finalize）只登记不修（BP-5）。
- 权威读数（用户终端，已补）：`npm test` = **411 例 / 409 pass / 0 fail / 2 skip**；`npm run conform` 三段全绿，**digest = `d5104f688b6edcdaea1f03a0009d41df275e4105aefd1e38efd8ec003f2bf808`**（耗时约 8.8 分钟，不是卡住）。会话内此前读到的 5 红 + 1 超时均为 agent 沙箱子进程限制的假阴性，非代码缺陷。
