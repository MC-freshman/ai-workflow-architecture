# Mastermind Bug Bounty Workflow 2.0.0（授权范围内的业务管道）

角色 `coordinator` 负责端到端协调：只在已授权范围内行动，所有结论必须绑定真实证据。
peer 委派通过平台已验证的 peer-dispatch 能力执行（`engine.dispatch_delegation`），
六位专家以精确版本锁定（见 agent `mastermind-bug-bounty@3.5.0` 的 `peer-lock.json`）。

<!-- stage:SCOPE -->
核对本次授权的范围、目标与禁止项：读取输入中的 engagement 说明，产出
`authorizedScope`（一句话范围）、`prohibited`（禁止项列表）与 `engagementId`。
`status=blocked` 的情况：范围内含未授权目标、缺少书面授权、或输入自相矛盾。
blocked 时不得执行任何外部动作，只做本地静态分析并在 `summary` 说明原因。
证据：本阶段 `output.json`（字段 stage/status/summary/authorizedScope/prohibited/engagementId）。
<!-- /stage:SCOPE -->

<!-- stage:RECON -->
在已确认范围内做被动侦察与资产指纹。需要外部动作时必须委派给锁定的专家：
`mastermind-recon`（范围核对与被动侦察）、`mastermind-js-analysis`（前端/JS 静态面）。
委派调用平台 peer-dispatch（不得虚构子运行结果）；把每个子运行的
`childRunId` / 状态 / 结果哈希写入本阶段证据的 `delegations` 数组，资产清单写入 `assets`。
禁止：主动扫描私网、云 metadata、相邻域名或未授权端口；未列入 `prohibited` 也不得越过 SCOPE 结论。
`status=blocked` 时只保留范围内可离线完成的部分；未能完成的检查写入 `unavailableChecks`。
<!-- /stage:RECON -->

<!-- stage:ANALYSIS -->
对 RECON 产出的候选逐项分析。必须委派：`mastermind-api-validation`（接口/鉴权面）、
`mastermind-crypto-analysis`（密码学与实现误用）。委派结果一一对应到 `candidates`，
每项含 `candidate`（问题）、`evidence`（证据路径或子运行结果哈希）、`peer`（来源专家）。
不得把指纹直接当作漏洞；证据不足的项标 `unverified` 并写明还缺什么。
委派记录写入 `delegations`（childRunId/status/resultSha256）。
<!-- /stage:ANALYSIS -->

<!-- stage:TRIAGE -->
分级与复现判定：委派 `mastermind-triage` 对 ANALYSIS 的候选做严重度与可复现性评估。
输出 `findings`：每项含 `id`、`severity`（critical/high/medium/low）、`reproducible`（true/false/partial）、
`peer`、`evidence`。不可复现或证据不足的候选必须降级并写明理由，不得保留无证据的高危结论。
委派记录写入 `delegations`。
<!-- /stage:TRIAGE -->

<!-- stage:REPORT -->
汇总交付：委派 `mastermind-reporting` 生成面向授权方的中文报告，写入 `reportPath`
（项目内相对路径），并在 `summary` 给出一页结论。报告必须逐条给出：范围、方法、
发现（含严重度与证据）、未验证项、修复建议、以及被跳过的检查（`unavailableChecks`）。
所有委派记录（childRunId/status/resultSha256）必须齐全，缺失即 `status=partial`。
<!-- /stage:REPORT -->
