# paper-scenario-literature-canon

建立可引用的文献正典与检索策略，并挡住水货

> 场景技能：`paper-author` 的 `literature-canon` 场景选中它时，本文进提示词上下文。
> 正文来源：nature / paper 技能卡的**首句与第一个规则小节的逐字引用**（标注语言、字节数与所引小节），
> 外加本场景的顺序与门禁。深度步骤不在本文里，按下述钉版原文现取。
> 上游池实测：348 个主题真实存在（268 英文 / 76 中文 / 0 日文，仅 8 个极短件），
> 与 ecc 池不同，这里没有成片的占位件。

## 本场景的顺序

1. 先按下面的钉版原文确认本场景要满足的契约与判据，再动笔。
2. 每条主张都要能指回证据行或明确降级；每张图都要能指回素材与统计口径。
3. 打磨与结构冲突时，**先保结构与可复核性**，再谈语言。

## 本场景的判据来源（逐字引用，深度现取）

上游卡：`nature-prior-art-search@1.0.0`、`nature-search-strategy@1.0.0`、`nature-research-anti-slop@1.0.0`

### 现取 `nature-prior-art-search@1.0.0`（中文，10638 B，引自 `## 检索渠道（**优先国知局公布公告站，再降级 WebSearch**）`）

    > 生成交底书全文**之前或生成过程中**必须执行；检索结论写入第一章 **1.1 现有技术** 及与本案的**区别论述**。
    —— 摘自该卡 `## 检索渠道（**优先国知局公布公告站，再降级 WebSearch**）` ——
    ### A. 中国专利公布公告（**优先**，官方站点）
    1. **站点**：[国家知识产权局 中国专利公布公告](http://epub.cnipa.gov.cn/)（**仅** `epub.cnipa.gov.cn`）。
    2. **工具**（本技能 `scripts/disclosure/`）：**`cnipa_epub_search.py`** —— **一步**完成公布站检索与结果解析（Playwright 过站点 WAF）；结果页 HTML **仅在内存中处理，不落盘**。成功时终端含 **`EPUB_NOTE:`**（ASCII，如 `html_bytes=… disk=0`）与 **`EPUB_HITS_JSON:`** 一行（JSON 数组：标题、公开号、链接、**`abstract`** 等）。
    3. **国知局检索词（生成阶段必做，须在拼 Bash 之前完成）**
       - **拆分责任在 Agent**：在**生成/构造命令阶段**，从本案技术方案、专利点或用户主题中归纳 **2～8 个与方案相关度高的检索单位**，**仅用 ASCII 空格分隔**，再写入 `cnipa_epub_search.py` 的参数。每一单位宜为 **有检索意义的语义块**，例如：**专业术语**、

### 现取 `nature-search-strategy@1.0.0`（英文，2067 B，引自 `## Query Construction`）

    > 1. Extract core concepts from the research question
    —— 摘自该卡 `## Query Construction` ——
    ### From topic to query
    1. Extract core concepts from the research question
    2. Identify synonyms and alternate spellings for each concept
    3. For biomedical topics: map concepts to MeSH terms via `pubmed_lookup_mesh`
    4. Assemble Boolean query: `(concept1 OR synonym1) AND (concept2 OR synonym2)`
    5. Add field qualifiers for precision: `[Title/Abstract]`, `[MeSH Terms]`, `[Journal]`
    6. Test and refine — if >500 results, add filters; if <10, broaden terms
    ### Query templates by domain
    | Domain | Template |
    |--------|----------|
    | Medical | `("disease"[MeSH]

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

检索策略、先行工作核对与"反水货"筛除是一件事的三面：先有正典，才有论证。

## 停下来拒绝的情形

- 数据、样本或受试者信息未获授权、涉密或属人类受试者而无伦理批件：停手，只写方法与限制，不产出结论。
- 未实际执行的核查、未跑出的图、未复现的数字：一律进 `unavailableChecks`，**不得写成已通过**；
  没有证据支撑的表述不得进入正文与回复信。
- 证据不足时的措辞升级（把"相关"写成"导致"、把样本内结论写成普适结论）：拒绝，改为限定表述或撤回。
- 未投中的稿子或已撤回的实验结果被包装成"已发表/已验证"：按谎报处理。
- 逐字复制他人受版权保护的正文进交付物：只引用与标注出处，不复制长段。
