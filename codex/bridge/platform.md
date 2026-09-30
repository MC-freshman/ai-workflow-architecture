# Codex 平台章

> 维护者：仅 **codex 会话**改本文件。

> **〔2026-09-22 治理口径更正（由 qoder 会话依用户「连平台章一起校订」的一次性授权代为登记；本章任何机检读数一字未改）〕** 三条复述型条款在本章的旧措辞请按此读法：① 凡「数模求解链（`math-solver-chain`）不承接」「交稿级须先确认目标平台已声明并验证」「不要默认转 zcode 交稿」一类句子，保留为**当时的实测快照**，不再是调用规则——用户 09-22 裁决**数模与其它 agentic workflow 等同**，`math-solver-chain` 不再是各平台需声明的能力项，环境需求按 BP-1 §1.6 三选一归属（见 `versions/架构基本原则.md` §9 第 11 条、`invocation-adapters-spec.md` §3.1）。② 凡「跨平台资源仲裁未满足 / 需用户单独授权」，该项自同日起**已从必需项中撤销**：续跑只需「版本一致性校验 + 带 sha256 的可回读交接载体」两项，平台内锁表即正确形态；代价明写在条文里（同一项目被两客户端同时开工不会被发现、会互相覆盖）。③ 判据 harness 的现行合法路径是 `tool/architecture-ops/versions/1.2.0/architecture_ops/invocation_matrix.py`（或本平台自己 `bridge/ops/` 那份）——旧 `zcode\workspaces\agentic-workflow-implementation\` 工作区 2026-09-17 已删除，任何指向它的命令行都跑不通。本节不改动本章任何 baseline 数字；如与本节冲突，**以本平台 baseline 件为准并回改本节**。其他平台不得改写。总框架：[../../HANDOFF.md](../../HANDOFF.md)
> 2026-09-14 由 Codex 会话按当前总框架补全。本章只声明 Codex 自己已验证的能力。

## 已有文件

- 机器配置：[bridge.json](bridge.json)
- 使用说明：[README.md](README.md)
- 统一调用说明：[invocation-manual.md](invocation-manual.md)
- MCP：`server.mjs`、`launch.cmd`；适配器 `runner_adapter.py`
- 显式本地 Skill：`../chatgpt/userdata/codex-home/skills/wf/`、`wfa/`；`workflow-hub/` 保留为公共规则与 `/wf`、`/wfa` 兼容路由；原有数模 Skill 保留
- 运行输出：`../runtime/`

## 当前接线（架构 3.0，2026-09-21）

- Codex 本地 runner 固定为 `wf-runner@0.9.0`，契约固定为 `runtime-contracts@1.3.0`，扫描器固定为 `repo-lint@0.4.0`；共享 `current.json` 未修改。
- `toolRoot`、`agentRoot`、`softwareRoot` 均显式声明；`software/_gateway@1.0.0` 与 Codex-owned gateway config 已接线。
- 脚本阶梯声明为 `kernel-sandbox → host-controlled`。host rung 只有在本次 run 的 prepare 请求携带明确同意时才可选用。
- 六个软件本体已由 Codex 独立登记并核对文件哈希；它们的共享快照仍为 `frozen:false`，真实 software-call 在 snapshot 门 fail-closed。
- 全部已登记 Workflow 的显式入口是 `$wf`，全部已登记 Agent 的显式入口是 `$wfa`；两者最终使用同一运行协议、输入封装、运行锁、状态、事件与证据格式。
- `/wf`、`/wfa` 继续作为 `workflow-hub` 识别的兼容消息前缀，不声称是 Codex 原生自定义斜杠菜单项。
- Agent 内部主工作流及依赖服从精确 `tool-lock`；调用方不能覆盖 Agent 的工作流。
- 两个数模 Skill 已接入统一三档：未写 = **草稿**；只有“过图”才做非严格图表 QA；只有“交稿”才推进该问所需验证、严格 QA 与冻结。已有项目禁止 runner INIT。
- 共享仓库只读；状态、证据、日志和工作副本只写入 `E:\ai\codex\runtime`。
- `ai_set_platform_default` 只切 Codex 本地默认，记录审计回执；在途 run 和其他平台不受影响。

## 已验证能力与边界

- 旧基线在 Codex WSL 环境完成过 runner/state、隔离脚本、数模九阶段与领域门禁验收；2026-09-14 已用 `0.5.2` 完成 G1/G2 补验。
- G1 数模黄金双链通过：直调与专家链均完成九阶段、数值结果与预览哈希一致、全部领域及图表门禁通过。
- G2 sprint-plan 对照通过：五类同输入案例完成 `2.0.1` / `2.1.0` 比较；四类完整输入在新版一次过完整性门禁，缺信息案例按契约阻断且未补造信息。
- `peerDispatch` 未在 Codex 配置中声明，按协议拒绝；不得借用其他平台的派发器冒充 Codex 能力。
- 2026-09-15 全资源接入矩阵：可调用项 `PASS 38`，预期例外 `EXPECTED 2`，`FAIL 0`。两个例外是引擎自调用 `wf-runner`，以及当前隔离能力不支持共享仓库只读挂载的 `repo-lint`。
- 独立 Workflow 运行并发 C1-C4 通过；同 Agent 两个 run、不同 Agent 两个 run 的四路并发补验也通过。同一 run 始终串行，同一数学项目的并行写入 C5 明确为 `NOT_RUN / must serialize`。
- 新 MCP 进程发现 11 个工具，并实测本地默认切换、默认来源解析、Workflow 与 Agent 两条 `prepare → next → stop`。`wf`、`wfa`、`workflow-hub` 三个 Skill 均通过结构校验，两个 `agents/openai.yaml` 均通过 YAML 解析；当前已打开的桌面会话仍需重启，才能刷新 `$` 选择器和工具目录。
- 合成黄金样本只证明回归链一致，不证明比赛模型正确。

## 3.0 验收状态

历史顺序项“配置与文档对齐 → G1 → G2 → MCP 重连验收”已闭合。本轮完成 3.0 配置接入与独立证据采集；当前桌面进程重载仍需在配置提交后完成。

3.0 本轮证据（均为 Codex 自有运行记录）：

- `runtime/maintenance/3.0-C/p3-floor-after.json`：三仓能力并集 27 项，`remediationMissing=1`（随后已补齐 profile 适配声明）。
- `runtime/maintenance/3.0-C/p4-floor.json`：`pass=20`、`declaredAbsent=5`、`unverified=2`、`remediationMissing=0`；剩余项为 peer、脚本证据、管理员 profile 和环境包名规范化。
- `runtime/maintenance/3.0-C/conform-*.json`：六个软件单格 digest；所有快照均明确返回 `frozen:false`。
- `runtime/maintenance/3.0-C/p5-matrix.json`：全矩阵原始结果 `PASS 38 / FAIL 7`；7 个差异均可归类为已登记的 `repo-lint@0.3.0` 版本冲突或六个软件快照未冻结，不是未分类的 harness 故障。
- `runtime/maintenance/3.0-C/p5-repo-lint-final.json` 与 `p5-software-final.json`：按本平台例外账复验为 `FAIL 0`，分别为 `EXPECTED 1` 与 `EXPECTED 6`；工作流主矩阵的 `PASS 38` 保持不变。
- 两次生产协议冒烟均完成 `prepare → next → stop`；脚本 live 扫描在环境校验超过预算后按协议停止，未伪报成功。

G1 证据：`../runtime/runs/20260914-g1-acceptance/reports/g1-paired-acceptance.json`；G2 证据：`../runtime/runs/20260914-g2-sprint-comparison/reports/g2-comparison.json`；通用矩阵、并发与默认切换证据位于 `../runtime/runs/20260915-codex-architecture-100/reports/`。

## 本平台必须遵守

隔离、版本锁、数模三档、禁止 INIT 清空已有项目：见总框架与 [../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §3.1。
