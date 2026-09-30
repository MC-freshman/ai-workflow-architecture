# game-postmortem 2.1.0（runner 适配版）

上游提示词原文（1.3.0）逐字节保留在 `upstream/workflow-2.0.1.md`，执行阶段按需阅读；
本文件只写 runner 适配契约、阶段锚点与封样要求。

**适配契约（M4-10）。** 上游的隐式数据抓取（git 历史、里程碑数据、Bash、
`argument-hint`）不执行：复盘范围与素材以显式输入到达（`scope`、`subject`、
`sources`——每项是纯文本素材或说明）。素材不足以支撑某条结论时写进 `missing`，
**不得编造时间线事件、数字或引文**。与 `game-retrospective` 的分工保持上游口径：
本工作流做项目/大阶段级、找系统性模式。

上游不变量（保留）：① 复盘不是追责也不是庆功，是结构化知识提取；② 时间线必须有
日期；③ 结论必须挂在证据上；④ 行动项必须有主责人与期限；⑤ 成功经验与失败教训同等重要。

<!-- stage:intake -->
**阶段 1 — Intake。** 确定复盘范围（sprint / milestone / project）、对象名称、
可用素材与分段（periods：如里程碑或阶段），并列出缺失信息。

封样 `output.json`（即 intake 文档，按 `schemas/intake.schema.json` 校验）：
`{scope, subject, periods: [{id, label}], sources: [...], missing: []}`。
<!-- /stage:intake -->

<!-- stage:analysis -->
**阶段 2 — Analysis。** 产出三件套：

1. `timeline`：按日期（`YYYY-MM-DD`）排列的事件，每条 `{id, date, event, kind}`
   （kind ∈ went-well / went-wrong / neutral），`period` 可选但必须存在于 intake；
2. `rootCauses`：每条 `{id, description, evidence: [timeline id...]}`——**至少引用一条
   时间线事件**，无证据的结论不得写入；
3. `actionItems`：每条 `{id, description, owner, due, addresses: [cause id...]}`——
   `owner` 不得为空，`due` 为 `YYYY-MM-DD` 或 `next-sprint` / `next-milestone` /
   `next-project`，`addresses` 必须指向真实根因。

`summary` 里声明的时间线条目数与行动项数必须与实际一致。

在本 attempt 证据目录内**逐字节复制**上一阶段的 `intake.json`，再封 `analysis.json`
与 `output.json`（即 analysis 文档，按 `schemas/analysis.schema.json` 校验）。
runner 随后运行 `postmortem-integrity`（`scripts/validate_postmortem.py`）核对
日期格式、引用完整性、责任人/期限、计数一致。违例可修复；`MISSING_INFO` 列给用户。
<!-- /stage:analysis -->

<!-- stage:repair -->
按 `postmortem-check.json` 的 findings 逐条修复：补引用、订正日期格式、补齐责任人与期限、
删除无证据的结论。禁止：为过门禁而删除有证据的根因或行动项、编造时间线事件、
改写上一阶段封样副本。修完重封 `analysis.json` 与 `output.json`。
<!-- /stage:repair -->

<!-- stage:report -->
**阶段 3 — Report。** 产出最终复盘文档：范围与素材、时间线（含好坏两类事件）、
根因分析（逐条绑证据）、行动项表（主责人 / 期限 / 对应根因）、可复用经验与反模式、
下一步。封 `output.json` = `{document, summary}`（按 `schemas/output.schema.json` 校验）。
<!-- /stage:report -->
