# paper-scenario-data-report

日常：数据核查与统计呈现一致性

> 场景技能：`paper-author` 的 `data-report` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-statistical-reporting@1.0.0`、`nature-figure-statistics@1.0.0`、`nature-package-consistency-audit@1.0.0`

### 现取 `nature-statistical-reporting@1.0.0`（英文，4034 B，引自 `## Minimum information to extract`）

    > Use this file when drafting or auditing a Statistical analysis, Methods, Results, or Supplementary Methods section.
    —— 摘自该卡 `## Minimum information to extract` ——
    For each major analysis, identify:
    - endpoint or response variable
    - experimental groups / conditions
    - independent experimental unit
    - biological replicates and technical replicates
    - repeated measures, paired observations, blocks, batches, sites, donors, animals, patients, plots, or model runs
    - inclusion / exclusion criteria
    - missing-data handling
    - randomization and blinding, if applicable
    - transformation or normalization
    - test or model name
    - assumptions checked or rationale for robust / nonparametric approach
    - multiple-comparison correction or

### 现取 `nature-figure-statistics@1.0.0`（英文，2902 B，引自 `## Legend information each quantitative panel should provide`）

    > Use this file when checking figure panels, legends, star labels, error bars, source data, or statistical annotations.
    —— 摘自该卡 `## Legend information each quantitative panel should provide` ——
    For each panel or panel group, check whether the legend states:
    - what points, bars, boxes, lines, or shaded regions represent
    - the exact definition of `n`
    - whether `n` is independent samples, animals, donors, patients, cultures, experiments, simulations, fields, cells, or technical replicates
    - summary convention: mean ± s.d., mean ± s.e.m., median with IQR, min-max, confidence interval, or model estimate
    - test/model used
    - paired/unpaired or repeated-measures status if relevant
    - multiple-comparison correction if multiple contrasts are displayed
    - 

### 现取 `nature-package-consistency-audit@1.0.0`（英文，10721 B，引自 `## 1. The coupling rule`）

    > 1. [The coupling rule](#1-the-coupling-rule)
    —— 摘自该卡 `## 1. The coupling rule` ——
    Response letters quote manuscript text. Every quote is a promise that the manuscript reads exactly
    that way. Any later edit to a quoted passage must be mirrored in the letter, or a reviewer
    comparing the two finds a mismatch and starts doubting everything else.
    Checks:
    - Every quoted passage in the letter appears **verbatim** in the expanded manuscript source,
      including statically named `\\input{...}` and `\\include{...}` files.
    - Editing a quoted manuscript sentence triggers a letter update in the same commit, not later.
    - Whitespace, hyphenation, a

## 一句话口径

统计呈现、包一致性与异常日志三者要对得上；对不上就是缺陷而不是四舍五入。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
