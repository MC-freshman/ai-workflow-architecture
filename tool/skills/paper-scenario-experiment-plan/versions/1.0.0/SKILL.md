# paper-scenario-experiment-plan

日常：实验设计与实验记录（含做不成的实验）

> 场景技能：`paper-author` 的 `experiment-plan` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-experiments-section@1.0.0`、`nature-impossible-experiment@1.0.0`、`nature-methods-paper-type@1.0.0`

### 现取 `nature-experiments-section@1.0.0`（英文，3080 B，引自 `## Default evidence ladder`）

    > Each subsection has a claim-first opening, then data support.
    —— 摘自该卡 `## Default evidence ladder` ——
    `establish the phenomenon -> stress-test it -> rule out alternatives -> broaden it -> interpret it -> bound it`
    Each subsection has a claim-first opening, then data support.
    Depending on the paper, instantiate this as a discovery loop, a core-capability
    plus validation envelope, or a capability ladder. Load
    `../../../../nature-shared/core/nature-results-discussion.md` for the three
    archetypes and the same-level-repetition test.

### 现取 `nature-impossible-experiment@1.0.0`（英文，1673 B，引自 `## Expected behavior`）

    > Editor decision: Major revision.
    —— 摘自该卡 `## Expected behavior` ——
    - Assign stable ID `R2.1`.
    - Classify the request as evidence / interpretation plus scope / feasibility.
    - Use `PARTIAL` or `OUT_OF_SCOPE` with a high-risk flag, not simple refusal.
    - Acknowledge the scientific value of longitudinal survival data.
    - Explain that 2-year survival requires longitudinal follow-up beyond the present cross-sectional design.
    - Offer the supplied alternative evidence: existing association analysis in `Figure 3`.
    - Add a limitation / softened claim action in the Discussion.

### 现取 `nature-methods-paper-type@1.0.0`（英文，1275 B，引自 `## Presentation arc — problem-to-solution`）

    > Covers methods, algorithm, tool, model, and system papers across fields, including AI and computational methods.
    —— 摘自该卡 `## Presentation arc — problem-to-solution` ——
    Best when the paper proposes a procedure and must show it works and is better. Order the story as:
    1. the current bottleneck or limitation,
    2. the proposed method,
    3. the workflow or architecture,
    4. the evaluation design,
    5. performance compared with baselines,
    6. ablation, robustness, or failure cases,
    7. reuse scenarios and limitations.

## 一句话口径

实验先定"看什么算数"，再记录；做不成/不可能做的实验要留在记录里而不是删掉。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
