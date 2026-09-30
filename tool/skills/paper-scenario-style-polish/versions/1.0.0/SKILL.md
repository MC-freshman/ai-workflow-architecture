# paper-scenario-style-polish

文体与语言打磨（含中文审稿语体）

> 场景技能：`paper-author` 的 `style-polish` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-style-guardrails@1.0.0`、`nature-punctuation-style@1.0.0`、`nature-chinese-review-writing-style@1.0.0`、`nature-research-anti-slop@1.0.0`

### 现取 `nature-style-guardrails@1.0.0`（英文，2669 B，引自 `## Academic style`）

    > Use this file for mechanical and stylistic checks after the main rewrite. This file should refine prose and correctness, not override the main writing strategy in `SKILL.md`.
    —— 摘自该卡 `## Academic style` ——
    - prefer cautious, precise prose over conversational confidence
    - avoid contractions
    - avoid rhetorical questions in polished manuscript prose
    - define abbreviations on first use
    - use British spelling by default if the target is Nature-style prose
    - keep figure legends concise; if aiming for Nature style, `<= 300` words is a good upper bound
    - if aiming for Nature style, keep titles at `<= 75` characters including spaces

### 现取 `nature-punctuation-style@1.0.0`（英文，1812 B，引自 `## Expected behavior`）

    > The manuscript supports one Major Concern and two Minor Comments. The review needs several explanatory transitions, parenthetical qualifications, and stable concern IDs.
    —— 摘自该卡 `## Expected behavior` ——
    - Write reviewer prose and post-review synthesis without relying on em dashes, en dashes, or colons as sentence connectors.
    - Use a new sentence, comma, semicolon, parentheses, or a short label followed by a new line according to the grammatical relationship.
    - Keep stable IDs such as `R1-M1` and established hyphenated terms such as `pre-submission`.
    - Preserve punctuation in source-faithful titles, quotations, formulas, identifiers, URLs, times, and required machine-readable syntax when changing it would make the source or format inaccurate.
    - Format co

### 现取 `nature-chinese-review-writing-style@1.0.0`（中文，4363 B，引自 `## 标题命名`）

    > 本文件规定中文综述写作的通用风格约束。不同于 proposal 写作，综述要求更高的事实密度、更清楚的证据等级和更克制的学术语感。
    —— 摘自该卡 `## 标题命名` ——
    标题是结构路标，不是叙事修辞。标题应说明“研究对象 + 分析角度”，避免比喻、拟人、口号和口语化提问。
    | 避免 | 原因 | 建议改写 |
    |---|---|---|
    | “材料命运的决定因素” | 拟人化 | “材料稳定性的影响因素” |
    | “参数 X：性能的总开关” | 夸张比喻 | “参数 X 对性能的控制作用” |
    | “如何看见界面变化” | 口语化提问 | “界面变化的表征方法” |
    | “工程收益与化学代价” | 叙事化 | “处理条件的双重影响” |

### 现取 `nature-research-anti-slop@1.0.0`（英文，1096 B，引自 `## Structural anti-patterns`）

    > Chinese proposal cleanup focused on research credibility, not generic prettiness.
    —— 摘自该卡 `## Structural anti-patterns` ——
    - Background too broad and not serving the research question
    - Literature list without synthesis
    - Innovation detached from methods
    - Conclusion stronger than evidence
    - Too many objectives without one main line
    - Discussion repeats results rather than explaining implications and limits
    Fix structural problems by returning to `03_argument_map.md` or `04_section_contracts.md`, not by sentence polishing.

## 一句话口径

风格护栏、标点规范与中文审稿语体是三套不同的约束，混用会同时失去三者。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
