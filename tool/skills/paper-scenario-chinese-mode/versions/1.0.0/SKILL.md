# paper-scenario-chinese-mode

中文作者模式：中式写作流程与对齐

> 场景技能：`paper-author` 的 `chinese-mode` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-chinese-author-workflow@1.0.0`、`nature-chinese-mode-core@1.0.0`、`nature-chinese-author-alignment@1.0.0`、`nature-zh-to-en-language@1.0.0`、`nature-zh-to-en@1.0.0`

### 现取 `nature-chinese-author-workflow@1.0.0`（英文，1821 B，引自 `## Drafting from author notes`）

    > Deep reference for Chinese, mixed Chinese-English, or lab-note input.
    —— 摘自该卡 `## Drafting from author notes` ——
    Use this sequence:
    1. Summarize the author's intended claim in Chinese.
    2. Identify missing evidence or boundary.
    3. Draft the English paragraph.
    4. Add short Chinese notes explaining any structural changes.
    Do not make the English sound like a literal translation. Make it sound like a
    Nature-style manuscript paragraph supported by the user's facts.

### 现取 `nature-chinese-mode-core@1.0.0`（中文，1193 B，引自 `## 首段`）

    > When the user writes in Chinese, provides a Chinese manuscript note, or asks for "中文对应", "中英对照", "数据可用性声明", "数据获取声明", "原始数据", "数据存储库", or "受限数据":

### 现取 `nature-chinese-author-alignment@1.0.0`（中文，5010 B，引自 `## Core terminology`）

    > Use this file when the user writes in Chinese, provides a Chinese Data Availability draft, or asks
    —— 摘自该卡 `## Core terminology` ——
    | 中文 | Preferred English | Notes |
    |---|---|---|
    | 数据可用性声明 / 数据获取声明 | Data Availability | Use the journal heading `Data Availability`. |
    | 本研究产生的数据 | data generated in this study | Include repository and identifier when public. |
    | 原始数据 | raw data | Do not call processed tables raw data. |
    | 处理后数据 | processed data | State whether processing scripts are available. |
    | 源数据 | source data | Usually data underlying figures or tables. |
    | 补充材料 / 附录 | Supplementary Information | Use exact file/table names when possible. |
    | 公共数据库 | public database / public repo

### 现取 `nature-zh-to-en-language@1.0.0`（英文，1616 B，引自 `## Translate intent, not syntax`）

    > Use this when the user's notes are Chinese, mixed Chinese-English, or organized as lab notes rather than manuscript prose.
    —— 摘自该卡 `## Translate intent, not syntax` ——
    Chinese academic notes often pack background, motivation, method, and implication into one long sentence. Before drafting English, split each note into:
    - claim
    - evidence
    - condition
    - comparison
    - implication
    - limitation
    Then write English in the order required by the section, not in the order of the Chinese sentence.

### 现取 `nature-zh-to-en@1.0.0`（英文，1241 B，引自 `## Workflow`）

    > When the source is Chinese or strongly Chinese-influenced English, do not translate clause-by-clause.
    —— 摘自该卡 `## Workflow` ——
    1. Extract the core propositions first. List them in plain English before drafting prose.
    2. Reconstruct explicit logical links: contrast, cause, implication, limitation. Chinese academic prose often elides these connectives — restore them.
    3. Verify terminology, causality, and hedging strength against the source.
    4. Keep technical terms, gene/protein names, model names, dataset names, and statistical terms stable; do not "translate" them into rough paraphrases.
    5. Apply the English sentence and paragraph rules from `language/en.md` only after the logic 

## 一句话口径

中文稿件不是英文稿的翻译层：流程、语体与术语对齐都要单独成立。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
