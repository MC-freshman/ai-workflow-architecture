# paper-scenario-proposal-assignment

日常：计划书、课程研究作业与文献推送

> 场景技能：`paper-author` 的 `proposal-assignment` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-nature-proposal-writer@1.0.0`、`nature-within-approved-proposal@1.0.0`、`nature-literature-push-template@1.0.0`

### 现取 `nature-nature-proposal-writer@1.0.0`（中文，7075 B，引自 `## 核心原则`）

    > 受 autonovel（状态机+打分）、professor（动态专家）、brainstorming（入口追问）、anti-AI-writing（语言清理）启发的科研写作状态机。**不是通用"帮我写论文"prompt。**
    —— 摘自该卡 `## 核心原则` ——
    1. **证据先于文字** — 起草前必须建立或读取 `research_canon` 和 `evidence_table`
    2. **论证先于章节** — 写正文前必须完成 `argument_map`
    3. **契约先于段落** — 每节需要 purpose / allowed claims / forbidden claims / inputs / validation
    4. **范围先于完备** — 如果是分阶段写作，先锁定阶段边界
    5. **动态专家，不设固定池** — 用 `professor` 按失败模式召唤对应专家
    6. **内容先于语言** — 诊断科学逻辑后再做 anti-slop / 语言打磨
    7. **不自动升级事实** — 永远不把 "may indicate" 改成 "proves"，除非有证据支撑
    8. **删除胜于解释** — 当某主张不可行，直接删除。正文干净，解释留给答辩
    9. **该停就停** — 平台期、专家冲突、证据缺失是停止理由，不是润色理由

### 现取 `nature-within-approved-proposal@1.0.0`（中文，4878 B，引自 `## 与 compose 模式的差异`）

    > 当用户在已立项项目框架下写研究计划——本子已批，不能改立意，但可以加深和细化执行方案。
    —— 摘自该卡 `## 与 compose 模式的差异` ——
    | 维度 | 标准 compose | 提案内写作 |
    |---|---|---|
    | 研究问题来源 | 从文献空白凝练 | 本子已给定，可深化但不可改写 |
    | 研究内容结构 | 自由设计 | 本子子内容固定，在本子框架内填充 |
    | 创新点 | 独立论证 | 作为自然组成嵌入，不另立旗帜 |
    | 科学张力 | 自建 narrative arc | 在本子已有张力基础上深化 |
    | 参考文献库 | 自由检索 | 本子已有文献 + 用户自有综述 |
    | 写作边界 | 用户定义 | 本子划定，超出需确认 |

### 现取 `nature-literature-push-template@1.0.0`（英文，5009 B，引自 `## Scoring Rubric`）

    > Generic literature monitoring workflow to copy and customize for a research field such as LLMs, agents, alignment, evaluation, retrieval, multimodal systems, or any other domain.
    —— 摘自该卡 `## Scoring Rubric` ——
    | Dimension | Weight |
    |---|---:|
    | Topic fit | 35 |
    | Novelty / contribution | 20 |
    | Method quality | 15 |
    | Source / author signal | 10 |
    | Practical value | 10 |
    | Archive value | 10 |
    Rules: no dimension exceeds its weight; total is the sum; display as `⭐ 8.7/10`; never output impossible scores like `11/10`.

## 一句话口径

计划书与课程作业的评分口径不同；引用范围不得超出被批准的计划书边界。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
