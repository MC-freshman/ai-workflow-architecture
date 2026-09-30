# paper-scenario-evidence-mapping

把结论逐项钉到可复核的证据上

> 场景技能：`paper-author` 的 `evidence-mapping` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-evidence-and-provenance@1.0.0`、`nature-multipanel-evidence-architecture@1.0.0`、`nature-corpus-pair-audit@1.0.0`

### 现取 `nature-evidence-and-provenance@1.0.0`（英文，2918 B，引自 `## Labels`）

    > Use the smallest applicable label:
    —— 摘自该卡 `## Labels` ——
    Use the smallest applicable label:
    | Label | Meaning | Required support |
    |---|---|---|
    | `[Paper]` | The paper explicitly reports or claims this | Page/section/figure/table/equation/block pointer |
    | `[External]` | A source outside the paper supports this | Direct citation or URL |
    | `[Analysis]` | The Agent infers this from identified evidence | Reasoning plus relevant source pointers |
    | `[Hypothesis]` | A testable but unverified explanation or idea | Proposed test and possible falsifier |
    | `[User]` | The user supplied this judgment or connection | 

### 现取 `nature-multipanel-evidence-architecture@1.0.0`（英文，12732 B，引自 `## Status and scope`）

    > Use this reference when planning, restructuring, or auditing a manuscript
    —— 摘自该卡 `## Status and scope` ——
    This is **corpus-derived Nature-style guidance, not an official journal
    requirement**. It was distilled from author-supplied readings of flagship
    *Nature* papers on MIRA (`s41586-026-10675-5`), centromere architecture
    (`s41586-026-10841-9`), Robin (`s41586-026-10652-y`) and TabPFN
    (`s41586-024-08328-6`), then generalized for Nature Portfolio manuscript
    figures. Current journal instructions, article-type rules, the actual evidence
    and the scientific question always take precedence.
    Do not copy a published paper's panel count or letter order as a template

### 现取 `nature-corpus-pair-audit@1.0.0`（英文，3005 B，引自 `## Purpose`）

    > Use the five numbered pairs as examples of drafting transformations, not as unquestioned one-to-one ground truth. File numbering establishes intended pairing only. Technical content and dates determine the strength of each match.
    —— 摘自该卡 `## Purpose` ——
    Use the five numbered pairs as examples of drafting transformations, not as unquestioned one-to-one ground truth. File numbering establishes intended pairing only. Technical content and dates determine the strength of each match.

## 一句话口径

每条主张要么有证据行、要么显式降级；证据与出处的可追溯性先于文字润色。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
