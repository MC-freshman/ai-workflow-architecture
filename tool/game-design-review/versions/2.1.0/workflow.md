# game-design-review 2.1.0（runner 适配版）

上游提示词原文（1.3.0）逐字节保留在 `upstream/workflow-2.0.1.md`，执行阶段按需阅读；
本文件只写 runner 适配契约、阶段锚点与封样要求。

**适配契约（M4-10）。** 上游的隐式工具调用（Read/Glob/Grep、`argument-hint`、
`context: fork`）不执行：设计文档与评审范围以显式输入到达（`designDocument` 内联正文，
或 `designPath` 指向快照内文件；`pillars`、`reviewFocus` 同）。输入缺失或文档不可读时，
把它写进 `missing` 并**停止**，不得编造文档内容。不隐式调用其他工作流
（game-balance-check / game-brainstorm 只能在结论里作为显式建议点名）。

上游不变量（保留）：① 先读完整篇再评论；② 每条发现必须标严重度；③ 必须有
"问题 + 章节 + 可执行建议"，禁止空泛评语；④ 提替代方案而非下命令；⑤ 尽量引用设计
理论；⑥ 跨章节矛盾优先于"缺章"本身。

<!-- stage:intake -->
**阶段 1 — Intake。** 通读设计文档，建立章节清单（id / title / present / notes），
记录三支柱与本次评审焦点；任何无法从输入得到的必要信息写入 `missing`。

封样 `output.json`（即 intake 文档，按 `schemas/intake.schema.json` 校验）：
`{scope: {document, pillars?, budget?}, sections: [{id, title, present, notes?}],
focus?, missing: []}`。缺章也要登记为 `present: false` 的条目——不要漏掉它。
<!-- /stage:intake -->

<!-- stage:review -->
**阶段 2 — Review。** 逐章产出发现项，每条给全：`id`、`severity`
（critical / major / minor）、`section`（**必须**是 intake 章节表里的 id）、
`evidence`（指出文档中的具体位置或引文，不得为空）、`recommendation`（可执行的
修改方向）、可选 `principle`。**引用了 `present: false` 章节的发现必须是
critical**（门禁强制）。`summary` 里声明的各严重度计数必须与实际条目数一致；
若确认没有问题，在 `summary.notes` 里明确说明而不是留空数组。

在本 attempt 证据目录内**逐字节复制**上一阶段的 `intake.json`（供门禁读取），再封
`review.json`（同名副本）与 `output.json`（即 review 文档，按
`schemas/review.schema.json` 校验）。runner 随后运行 `review-integrity`
（`scripts/validate_review.py`）核对：章节引用存在、缺章必为 critical、证据与建议非空、
id 唯一、计数一致。违例可修复；`MISSING_INFO` 不可编造，必须列给用户。
<!-- /stage:review -->

<!-- stage:repair -->
按 `review-check.json` 的 findings 逐条修复：只做 findings 解释得通的改动
（补证据、订正严重度、改计数、删除无依据条目）。禁止：为过门禁而删除有证据的发现、
编造引文、改写上一阶段封样副本。修完重封 `review.json` 与 `output.json`。
`MISSING_INFO` 类 finding 原样列给用户，不要试图绕开。
<!-- /stage:repair -->

<!-- stage:report -->
**阶段 3 — Report。** 产出最终评审文档：概述、逐条发现（严重度 / 章节 / 证据 / 建议）、
跨章节一致性问题、优先级建议、下一步。封 `output.json` = `{document, summary}`
（按 `schemas/output.schema.json` 校验）；`document` 为完整 markdown 正文。
<!-- /stage:report -->
