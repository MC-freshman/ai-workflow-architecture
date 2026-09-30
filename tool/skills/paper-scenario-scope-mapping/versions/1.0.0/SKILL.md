# paper-scenario-scope-mapping

把稿件对到期刊与文体上：先定刊物范围与体裁档位，再动笔

> 场景技能：`paper-author` 的 `scope-mapping` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-journal-scope@1.0.0`、`nature-nature-journal-formats@1.0.0`、`nature-nat-comms-journal-formats@1.0.0`

### 现取 `nature-journal-scope@1.0.0`（英文，2152 B，引自 `## Default families`）

    > The skill's default journal-family boundary is intentionally practical rather than exhaustive. Use it
    —— 摘自该卡 `## Default families` ——
    ### Nature Portfolio
    Include:
    - `Nature`
    - journals beginning with `Nature `, such as `Nature Medicine`, `Nature Biotechnology`,
      `Nature Methods`, `Nature Materials`, `Nature Genetics`, `Nature Communications`
    - `Communications` journals, such as `Communications Biology`, `Communications Chemistry`,
      `Communications Materials`, `Communications Earth & Environment`, `Communications Medicine`
    - `npj` journals
    - `Scientific Reports`
    Be careful with unrelated titles that include the common word "nature".
    ### Science family
    Include by default:
    - `Sci

### 现取 `nature-nature-journal-formats@1.0.0`（英文，13555 B，引自 `## 1. Authority and stage gate`）

    > Canonical shared rules for an original-research **Article submitted to the
    —— 摘自该卡 `## 1. Authority and stage gate` ——
    Before applying a rule, record the stage:
    - `initial_submission`: before the first editorial decision; Nature permits
      reasonable formatting flexibility.
    - `revision`: after review; follow the handling editor's instructions in
      addition to the public guide.
    - `accepted_in_principle`: production-quality text, figures, Extended Data,
      Supplementary Information, forms and declarations are requested.
    - `proof`: production corrections only; not a new manuscript rewrite.
    Do not reject an otherwise reviewable initial submission merely because it has
    not ye

### 现取 `nature-nat-comms-journal-formats@1.0.0`（英文，7045 B，引自 `## Article types and limits`）

    > Authoritative facts about Nature Communications formatting requirements. Used by both `nature-polishing` and `nature-writing` when `journal=nat-comms`. This file holds the **facts**; each skill's `static/fragments/journal/nat-comms.md` adds
    —— 摘自该卡 `## Article types and limits` ——
    | Article type | Body words | Abstract | References | Display items | Methods placement |
    |---|---|---|---|---|---|
    | **Article** | ~5,000 (incl. Methods) | 150 words | ~60 | up to 10 (figures + tables combined) | within main text |
    | **Brief Communication** | ~2,000 (incl. Methods) | 100 words | ~20 | up to 4 | within main text |
    | **Review** | ~6,000 | 200 words | ~100 | flexible | N/A |
    | **Perspective** | ~4,000 | 150 words | ~50 | flexible | N/A |
    | **Correspondence** | ~500 | none | ~10 | 1 | within main text |
    ### Critical word-count quirk (Artic

## 一句话口径

先定"投谁、什么体裁、哪一档"，再谈内容。刊物范围与格式约定不核对就开写，后面每一段都可能白写。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
