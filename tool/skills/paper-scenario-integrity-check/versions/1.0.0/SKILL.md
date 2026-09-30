# paper-scenario-integrity-check

科研诚信与可复核性：自审、一致性清扫、伦理、披露与元数据

> 场景技能：`paper-author` 的 `integrity-check` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-defensive-draft-audit@1.0.0`、`nature-consistency-sweep@1.0.0`、`nature-ethics@1.0.0`、`nature-disclosure-self-check@1.0.0`、`nature-disclosure-builder@1.0.0`

### 现取 `nature-defensive-draft-audit@1.0.0`（英文，2243 B，引自 `## Expected behavior`）

    > Mode requested: audit and revise this draft response.
    —— 摘自该卡 `## Expected behavior` ——
    - Detect task mode as `audit` or `revise`.
    - Assign stable IDs `R1.1` and `R1.2`.
    - Flag the author draft as defensive and insufficiently traceable.
    - Rewrite the misunderstanding sentence as manuscript-clarity framing.
    - Remove "We already explained the calibration in the paper" as impolite reviewer-facing language.
    - Treat `R1.1` as `CLARIFY_EXISTING` plus possible `ACCEPT_TEXT`.
    - Treat `R1.2` as `ACCEPT_TEXT` with supplied version `v2.3.1`.
    - Use section names rather than invented line numbers.
    - Mark package readiness as `draft_with_placeholders` or

### 现取 `nature-consistency-sweep@1.0.0`（英文，7783 B，引自 `## 1. Sweep, then inspect`）

    > A retrospective audit of a manuscript that already exists. `terminology-ledger.md` is preventive:
    —— 摘自该卡 `## 1. Sweep, then inspect` ——
    Count variants mechanically first, then read the contexts before changing anything. Raw counts
    over-report: Title Case in captions and headings, sentence-initial capitals, first-use acronym
    expansions, and grammatically required inflections are legitimate variation.
    For each axis, count every variant, then open the contexts of the minority forms. A term used 33
    times one way and once another way is almost always a real slip; a term split 5/4 usually means two
    different concepts are being conflated.
    Start the mechanical pass with the bundled checker, re

### 现取 `nature-ethics@1.0.0`（英文，3424 B，引自 `## Intellectual debt`）

    > Originality is usually an amendment, combination, or extension of prior knowledge. A careful writer acknowledges that debt openly. Do not minimize others' contributions just to make the present work seem more original.
    —— 摘自该卡 `## Intellectual debt` ——
    Originality is usually an amendment, combination, or extension of prior knowledge. A careful writer acknowledges that debt openly. Do not minimize others' contributions just to make the present work seem more original.

### 现取 `nature-disclosure-self-check@1.0.0`（中文，6068 B，引自 `## 8.2 公式与参数一致性`）

    > 自检结果用于**修订正文**，默认**不单独输出自检报告**；用户索要时可单独提供。**不得**将自检清单作为交底书一章写入正文。
    —— 摘自该卡 `## 8.2 公式与参数一致性` ——
    **Step 8 必做（含公式时）**：除符号体例与跨节一致外，须**主动复核公式是否正确、公式逻辑是否与第三章叙述一致**（等同用户会提出的「检查公式和公式逻辑是否有误，有误请调整」）；发现问题**直接改稿**，勿仅提示用户自行修改。
    ### 符号与体例
    - [ ] **符号表（3.4.1）**：全文含公式时是否已设 **3.4.1** 并 **先定义符号**（含义、下标、量纲）；式 (1) 及后文每个符号是否均已在表中定义？
    - [ ] **维度下标**：是否存在 `^{cpu}`、`^{mem}`、`^{io}` 等 **上标表示维度** 的写法？若有须改为 `b_{i,\mathrm{cpu}}`、`a_{j,\mathrm{mem}}` 等 **下标 + `\mathrm{}`** 形式（见 **`disclosure_builder.md` §7.7**）
    - [ ] **字母多义**：同一字母是否兼指任务侧与节点侧等不同对象？若有须拆分符号（如任务用 \(b\)、节点用 \(g\)）
    - [ ] **公式表述一致**：同一物理量在不同公式、段落中是否 **同形同义**（如权重公式、调整系数、匹配分 \(M_{ij}\) 等）
    - [ ] **LaTeX 体例**：行内/块级分隔符是否全

### 现取 `nature-disclosure-builder@1.0.0`（中文，12434 B，引自 `## 7.1 章节结构`）

    > 详细章节范例与 **mermaid** 图示模版见同目录 **`template_reference.md`**。
    —— 摘自该卡 `## 7.1 章节结构` ——
    **第一章 1.1 撰写硬性要求**：在「按技术方向分类」的**每一条**现有技术（专利或文献）末尾或表格中，必须给出 **经核验的公开源 URL**（规范与示例见 `prior_art_search.md` 与 `template_reference.md` §1.1）。**国知局检索**（`EPUB_HITS_JSON`）中对该专利给出的 **`abstract` 非空时**：文中「技术方案 / 应用 / 局限」类表述**须以摘要理解为前提**（消化后重写，非整段粘贴），**禁止**与摘要明显矛盾或脱离摘要杜撰；详见 **`prior_art_search.md`**「`abstract` 必用」。
    **禁止输出**：交底书正文中**不得**包含「自检清单」章节，例如检查项表格或带状态符号的清单列。自检见 `disclosure_self_check.md`，**内部执行**，不写入交付正文。
    **禁止仓库/技能脚注**：交付用 Markdown **末尾不得**出现任何指向本技能或示例仓库的说明，例如「本文件为 `patent-disclosure-skill` 仓库内教学示例」「不构成任何法律或技术承诺」「虚构教学」「详见 `examples/`」等。正文**止于第六章及此前章节**；**不

## 一句话口径

交付前的一致性与披露自审是硬门禁性质；"没做"要写成没做，不得留白冒充通过。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
