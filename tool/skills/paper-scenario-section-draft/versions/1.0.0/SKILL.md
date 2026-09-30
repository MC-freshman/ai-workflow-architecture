# paper-scenario-section-draft

分节起草：引言 / 方法 / 结果 / 讨论 / 结论 / 摘要

> 场景技能：`paper-author` 的 `section-draft` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-introduction@1.0.0`、`nature-nature-introduction@1.0.0`、`nature-nature-results-discussion@1.0.0`、`nature-results@1.0.0`、`nature-discussion-section@1.0.0`

### 现取 `nature-introduction@1.0.0`（英文，15709 B，引自 `## How to Think About Introduction: Backward First, Then Forward`）

    > Write a strong introduction in three steps:
    —— 摘自该卡 `## How to Think About Introduction: Backward First, Then Forward` ——
    ### Backward reasoning (answer these first)
    1. What technical problem do we solve, and why is there no well-established solution? (important)
    2. What are the contributions of our pipeline (e.g., a new valuable task, a new valuable metric, a new technical problem, or a new technique)?
    3. What are the benefits of our contributions, why can they solve this technical challenge, and what new insight do they bring? (important)
    4. How do we use prior methods to lead readers to our solved challenge and our new insight?
    ### Forward story (write in this order)

### 现取 `nature-nature-introduction@1.0.0`（英文，7680 B，引自 `## Make the Introduction converge`）

    > Use this reference when drafting, restructuring, or polishing an Introduction
    —— 摘自该卡 `## Make the Introduction converge` ——
    Build a narrowing argument rather than an extended topic overview:
    `important problem -> specific phenomenon or difficulty -> what existing approaches establish -> unresolved limitation or tension -> exact unknown -> research question or hypothesis -> what this study does`
    Move quickly. Assume the target journal's readers understand the broad field's
    importance; use only enough context to make the specific unresolved problem
    intelligible. By the end of the opening paragraph, expose the concrete
    phenomenon, contradiction, failure condition, or bottlenec

### 现取 `nature-nature-results-discussion@1.0.0`（英文，10288 B，引自 `## Core division of labour`）

    > Use this reference when drafting, restructuring, or polishing Results and
    —— 摘自该卡 `## Core division of labour` ——
    - **Results:** establish and advance the paper's scientific claims through an
      evidence chain. Results may include comparison, ablation, perturbation,
      robustness, failure analysis, directly evidence-bound interpretation, and a
      local inference.
    - **Discussion:** synthesize several established claims into a higher-order
      understanding, relate that understanding to prior work, explain its
      importance, and bound its implications.
    Do not enforce the mechanical split `Results = facts only` and
    `Discussion = all interpretation`. The operative boundary i

### 现取 `nature-results@1.0.0`（英文，2808 B，引自 `## Sentence syntax (Results vs Discussion)`）

    > Results are the evidence chain that establishes and advances the paper's
    —— 摘自该卡 `## Sentence syntax (Results vs Discussion)` ——
    Results sentences usually report:
    - `was detected`
    - `increased`
    - `showed`
    - `enabled`
    - `achieved`
    Use interpretive syntax (`may reflect`, `suggests that`, `is likely due to`)
    only when the transition is intentional, evidence-bound, and calibrated.

### 现取 `nature-discussion-section@1.0.0`（英文，1796 B，引自 `## Drafting rules`）

    > Load `../../../../nature-shared/core/discussion-argument-language.md` for the
    —— 摘自该卡 `## Drafting rules` ——
    - Discussion **synthesizes across established Results claims**; it does not
      repeat the evidence figure by figure.
    - Address rival explanations before generalizing. Reviewers look for this.
    - Hedging strength must match evidence strength. Do not promote a "consistent with" finding to "demonstrates" wording.
    - Limitations come from inside the paper, not from generic disclaimers. Name the specific condition or dataset where the result stops holding.

## 一句话口径

分节契约先行：每节的输入、输出与禁止项写清后再起草，避免各节互相矛盾。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
