# security-scenario-evidence-pack

证据成文：单漏洞报告与高管摘要

> 场景技能：`mastermind-bug-bounty` 的 `evidence-pack` 场景选中它时，本文进提示词上下文。
> 正文不是新写的说明书——下面每段都逐字取自本场景要用的那张技能自己的 `description`
> （含 Use when / Threshold / Trigger）。合并只做两件事：哪些卡属于这一步、按什么顺序、
> 什么情况下必须停；**具体深度步骤不在本文里，按下述钉版原文现取**。

## 第 1 步 · novel-composing-vulnerability-report-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-composing-vulnerability-report-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Read findings JSONL files from cluster 1-4 skills, deduplicate
by fingerprint, group by severity, and compose a deliverable-
grade markdown vulnerability report with per-finding sections
(title, severity, target, detail, remediation, evidence) and a
top-level summary table. The canonical written artifact a customer
receives at engagement close; precise, reproducible, machine-
checkable against source findings.
Use when: closing an engagement, generating an interim report,
regenerating after CVE or OWASP enrichment, or producing the
input for generating-executive-summary.
Threshold: findings missing required fields are dropped. HIGH
and CRITICAL findings highlighted in the summary section.
Trigger with: "compose vuln report", "write pentest report",
"generate vulnerability deliverable", "render findings to report".

## 第 2 步 · novel-generating-executive-summary-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-generating-executive-summary-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Risk score (0-100) composition / Top-3 remediation priorities / Prerequisites / Instructions

> 以下 `description` 为该卡原文逐字：

Compose an exec-readable summary from a unified findings JSONL
plus the OWASP coverage report. Computes a single engagement
risk score (0-100, severity-weighted with OWASP-breadth and
governance terms), rolls up findings into headline counts, names
the top-3 remediation priorities with effort + impact estimates,
and produces a 1-2 page markdown document for a C-level or board
audience. Elides technical detail; the vulnerability report is
the deep document.
Use when: closing an engagement, preparing the exec-readout
meeting, packaging for board review, or producing a one-page
narrative for auditor / insurer / board.
Threshold: input findings missing produces CRITICAL operational
finding; otherwise the deliverable is the document itself.
Trigger with: "generate exec summary", "executive summary",
"C-level readout", "board pentest summary".


## 停下来拒绝的情形

- 未拿到书面授权与范围（ROE）时：只做被动、本地、离线分析，不发任何外部请求；第 1 张卡未完成前不得进入扫描。
- 目标不在已核对范围内，或落在私网、云 metadata、相邻域名、未授权端口：拒做，记 PENDING 并写明原因。
- 卡片里带 `disallowed-tools`（`rm` / `curl` / `wget` / `nmap` / 写 `.env` 等）的动作：那是该技能自带的硬约束。
  本引擎不解释 Claude Code 的 allowed-tools 字段，所以这条要由执行时自我约束，不得当成"没被强制就可以做"。
- 指纹、配置项、缺失的响应头本身不是漏洞，不得写成 finding；只有可复现的证据链才进报告。
- 无法复现或未取到一手证据的结论：标 INFO/PENDING，不升级为风险等级。
