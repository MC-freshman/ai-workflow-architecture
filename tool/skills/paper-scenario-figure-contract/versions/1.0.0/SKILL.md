# paper-scenario-figure-contract

图件契约：素材、图注、统计呈现与图形摘要

> 场景技能：`paper-author` 的 `figure-contract` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-figure-contract@1.0.0`、`nature-figure-assets@1.0.0`、`nature-figure-legend-conventions@1.0.0`、`nature-figure-statistics@1.0.0`、`nature-ai-graphical-abstract-workflow@1.0.0`

### 现取 `nature-figure-contract@1.0.0`（英文，5552 B，引自 `## Privacy rule`）

    > Use this reference before writing plotting code. The goal is to make the figure
    —— 摘自该卡 `## Privacy rule` ——
    Keep the figure contract user-facing, but keep the working trail private. Do not mention
    private paths, source filenames, internal reference documents, template identifiers, or
    where a private draft came from unless the user explicitly asks for provenance.

### 现取 `nature-figure-assets@1.0.0`（英文，4693 B，引自 `## Step 4 detail — select figures as evidence, not decoration`）

    > Open this reference for steps 4-5: selecting figures as evidence, extracting and preparing assets, and the figure-crop self-check.
    —— 摘自该卡 `## Step 4 detail — select figures as evidence, not decoration` ——
    Inspect the source for: graphical abstracts or summary models; study design and workflow diagrams; central result figures; microscopy or imaging panels; heatmaps, dimensionality reduction, networks, maps, or spatial plots; survival curves, forest plots, calibration curves, or statistical result plots; materials characterization and performance plots; model architecture, benchmark, ablation, or error analysis figures; key tables; validation or control figures.
    Prioritize figures that carry the paper's argument:
    1. design/workflow,
    2. main evidence,
    3. v

### 现取 `nature-figure-legend-conventions@1.0.0`（英文，5165 B，引自 `## Legend structure — the fixed skeleton`）

    > Use this file when **writing or auditing the legend text** of a figure or table.
    —— 摘自该卡 `## Legend structure — the fixed skeleton` ——
    1. **`Fig. N | ` + a bold noun-phrase overall title** that names the whole
       figure. Common openers: *Overview of …*, *Comparison of …*, *Performance of
       …*, or a finding phrase. No terminal full stop required on the title.
    2. **`a / b / c …` panels, each described in present tense, telegraphic style**,
       often subject-less: *"a Comparison of the four EMS paradigms. b Distributions
       of WSIs and patches in the pre-training dataset."*
    3. **Statistics written into the legend**: sample size `n=`, error type, and
       test — *"mean ± 95% CI (n = 1373) … o

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

### 现取 `nature-ai-graphical-abstract-workflow@1.0.0`（英文，6263 B，引自 `## Authority boundary and policy gate`）

    > Use this reference whenever a task involves planning, generating, revising, or
    —— 摘自该卡 `## Authority boundary and policy gate` ——
    - Treat Ananya Thakur's 22 July 2026 *Nature* Careers column as practitioner
      guidance, not as a Nature Portfolio submission policy or blanket permission
      to publish AI-generated artwork.
    - Before generating a submission candidate, verify the target journal's current
      graphical-abstract, artificial-intelligence, image-integrity, copyright, and
      disclosure rules on official pages. Record the journal, URL, and access date.
    - For a Nature Portfolio target, apply the current risk-assessment framework:
      assistive use can support expression or organizatio

## 一句话口径

图是契约不是装饰：素材可溯源、图注自洽、统计呈现与正文数字一致，缺一即退回。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
