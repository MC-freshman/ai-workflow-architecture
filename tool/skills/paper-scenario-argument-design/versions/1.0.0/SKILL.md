# paper-scenario-argument-design

设计论证骨架：假设、论证图与缺口分析

> 场景技能：`paper-author` 的 `argument-design` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-discussion-argument-language@1.0.0`、`nature-hypothesis-paper-type@1.0.0`、`nature-gap-analysis@1.0.0`

### 现取 `nature-discussion-argument-language@1.0.0`（英文，9457 B，引自 `## Use the reverse funnel as a direction, not a template`）

    > Use this reference when drafting, restructuring, or polishing a scientific
    —— 摘自该卡 `## Use the reverse funnel as a direction, not a template` ——
    Introduction usually narrows from the field to the paper's precise question.
    Discussion generally moves in the opposite epistemic direction:
    `specific findings -> integrated interpretation -> relation to the field -> bounded implications`
    This is a reader-orientation principle, not a demand that every Discussion
    begin with a Results summary or end with a grand claim. Expand only as far as
    the evidence permits. A narrow study may properly end with a narrow
    implication.
    Choose the opening anchor that best restores the central context:
    - revisit the unr

### 现取 `nature-hypothesis-paper-type@1.0.0`（英文，1043 B，引自 `## Drafting rules`）

    > The argument tries to establish or rule out a causal explanation.
    —— 摘自该卡 `## Drafting rules` ——
    - State the hypothesis explicitly and locatably. Do not bury it in the third paragraph of the Introduction.
    - State up front what observations would refute the hypothesis. This earns trust later.
    - Distinguish "supporting" evidence from "consistent but non-discriminating" evidence. Many drafts conflate them.
    - In Discussion, address rival explanations **before** generalizing. Skipping this is the most common rejection point for hypothesis papers.
    - Hedging must match causal strength. Correlational evidence cannot ground mechanism verbs (`drives`, `causes

### 现取 `nature-gap-analysis@1.0.0`（英文，2442 B，引自 `## Workflow (4 steps)`）

    > When the user asks to confirm whether a specific research topic has been explored:
    —— 摘自该卡 `## Workflow (4 steps)` ——
    ### Step 1: Multi-source search
    Search the exact topic string across at least 3 sources:
    - Web search with exact phrase match (e.g., `"MgCl2-KCl-NaCl-ZnCl2"`)
    - Broader search with key components (e.g., `material A material B compound`)
    - Adjacent/related terms (e.g., `compound A thermal storage application`)
    → Record hit counts per query.
    ### Step 2: Decompose and classify
    If direct hits = 0, decompose the system into sub-systems:
    | Sub-system | Search | Status |
    |------------|--------|--------|
    | MgCl₂-KCl-NaCl (ternary) | keyword | studied / not 

## 一句话口径

论证结构先于段落。假设要可反驳，论证图要能指出缺口在哪。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
