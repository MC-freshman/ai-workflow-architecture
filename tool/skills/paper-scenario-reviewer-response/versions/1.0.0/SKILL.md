# paper-scenario-reviewer-response

审稿应对：分歧裁决、大小修与更正

> 场景技能：`paper-author` 的 `reviewer-response` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-conflicting-reviewers-tests@1.0.0`、`nature-conflicting-reviewers@1.0.0`、`nature-minor-revision@1.0.0`、`nature-minor-revision-tests@1.0.0`、`nature-major-revision-missing-evidence@1.0.0`

### 现取 `nature-conflicting-reviewers-tests@1.0.0`（英文，2534 B，引自 `## Expected behavior`）

    > Editor decision: Major revision.
    —— 摘自该卡 `## Expected behavior` ——
    - Assign editor instruction ID `E.1` and address it before reviewer comments.
    - Assign reviewer IDs `R1.1` and `R2.1`.
    - Detect a conflict between Reviewer 1 and Reviewer 2 in the internal/editor master only.
    - Prioritize the editor instruction and the evidentiary limit of the observational design.
    - Use `SOFTEN_CLAIM` for `R2.1`.
    - Use `PARTIAL` or `DISAGREE` for the stronger causal-claim request in `R1.1`, with respectful reasoning.
    - Avoid incompatible promises.
    - Produce separate Reviewer 1 and Reviewer 2 response files.
    - Explain the chosen associat

### 现取 `nature-conflicting-reviewers@1.0.0`（英文，1882 B，引自 `## Expected handling`）

    > This synthetic example shows how editor instructions and evidence limits control the response when
    —— 摘自该卡 `## Expected handling` ——
    - Assign the editor instruction `E.1`.
    - Assign reviewer comments `R1.1` and `R2.1`.
    - Surface the conflict only in the internal/editor strategy summary.
    - Prioritize the editor instruction and the observational design.
    - Use `SOFTEN_CLAIM` for `R2.1`.
    - Use `PARTIAL` or `DISAGREE` for `R1.1`, with respectful reasoning.

### 现取 `nature-minor-revision@1.0.0`（英文，1848 B，引自 `## 首段`）

    > This synthetic example shows the expected output shape for a minor revision. It is not based on

### 现取 `nature-minor-revision-tests@1.0.0`（英文，1396 B，引自 `## Expected behavior`）

    > Editor decision: Minor revision.
    —— 摘自该卡 `## Expected behavior` ——
    - Assign stable IDs: `R1.1`, `R1.2`, `R2.1`.
    - Classify `R1.1` and `R1.2` as minor editorial / presentation comments.
    - Classify `R2.1` as citation / positioning with missing citation metadata.
    - Draft concise English responses for `R1.1` and `R1.2`.
    - Mark `R2.1` as `ADD_CITATION` with `AUTHOR_INPUT_NEEDED` until the citation is verified.
    - Use section names when line numbers are absent.

### 现取 `nature-major-revision-missing-evidence@1.0.0`（英文，1818 B，引自 `## Expected behavior`）

    > Editor decision: Major revision.
    —— 摘自该卡 `## Expected behavior` ——
    - Assign stable IDs: `R1.1`, `R1.2`.
    - Classify `R1.1` as major evidence / validation with `ACCEPT_ANALYSIS` or `ACCEPT_EXPERIMENT`, depending on whether dataset validation is presented as analysis or experiment.
    - Mention dataset `GSEXXXX` and `Fig. 5` because the author supplied them.
    - Flag missing result details for `R1.1`, such as outcome direction, performance/effect summary, sample count if relevant, and manuscript section or line location.
    - Classify `R1.2` as statistical / methodological and flag missing exact details.
    - Request the statistical 

## 一句话口径

审稿人分歧要裁决而不是平均；大修缺证据就承认缺，不做文字腾挪。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
