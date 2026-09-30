# security-scenario-engagement-gate

授权核对、范围枚举与会战留痕——任何主动扫描之前的门禁

> 场景技能：`mastermind-bug-bounty` 的 `engagement-gate` 场景选中它时，本文进提示词上下文。
> 正文不是新写的说明书——下面每段都逐字取自本场景要用的那张技能自己的 `description`
> （含 Use when / Threshold / Trigger）。合并只做两件事：哪些卡属于这一步、按什么顺序、
> 什么情况下必须停；**具体深度步骤不在本文里，按下述钉版原文现取**。

## 第 1 步 · novel-confirming-pentest-authorization-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-confirming-pentest-authorization-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / ROE attestation file schema / Instructions / Examples

> 以下 `description` 为该卡原文逐字：

Verify that a penetration test has explicit, written, signed
authorization before any scanning begins. Reads a Rules-of-
Engagement (ROE) attestation file, validates required fields
(authorizer, in-scope targets, time window, emergency contact,
signature), checks the signer against an allowlist, and emits a
CRITICAL finding if anything is missing. Designed as the first
skill the orchestrator routes to.
Use when: starting a new engagement, after a scope change, or
before any cluster 1-4 scan skill runs.
Threshold: any missing or unsigned ROE field; any time-window
expiry; any in-scope target outside the authorized list.
Trigger with: "confirm authorization", "verify ROE", "check
pentest authz", "pre-flight authorization".

## 第 2 步 · novel-defining-pentest-scope-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-defining-pentest-scope-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Target syntax forms / Instructions / Examples

> 以下 `description` 为该卡原文逐字：

Parse the ROE scope definition, enumerate every in-scope target
(hostnames, IPs, CIDRs, URLs, cloud accounts, SaaS tenants),
validate syntax, detect overlap with out-of-scope or known
third-party SaaS ranges, and emit a normalized target list plus
IP allowlist for scanning tools. Runs after confirming-pentest-
authorization and before any cluster 1-4 scan.
Use when: starting an engagement, expanding scope mid-engagement,
validating that a target list matches the ROE, or generating an
allowlist for an external scanner.
Threshold: malformed syntax, in-scope overlap with out-of-scope,
reserved or third-party SaaS ranges without acknowledgement.
Trigger with: "define scope", "enumerate targets", "validate
target list", "generate IP allowlist".

## 第 3 步 · novel-recording-pentest-engagement-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-recording-pentest-engagement-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Recommended engagement directory structure / Instructions / Examples

> 以下 `description` 为该卡原文逐字：

Package an engagement's findings, scan outputs, evidence, and
signed ROE into a timestamped archive with a SHA-256 manifest
covering every file. Establishes chain of custody so legal
counsel, internal audit, or an outside SOC can verify the archive
hasn't been modified after closeout. Optionally signs the
manifest with GPG for cryptographic attestation.
Use when: closing an engagement, snapshotting evidence after
each scan day, before handing artifacts to customer, or after
an emergency-stop event.
Threshold: file in tree without a manifest entry, hash mismatch,
out-of-tree path referenced in findings, unsigned manifest when
signing was requested.
Trigger with: "record engagement", "archive evidence", "create
chain of custody", "package pentest artifacts".


## 停下来拒绝的情形

- 未拿到书面授权与范围（ROE）时：只做被动、本地、离线分析，不发任何外部请求；第 1 张卡未完成前不得进入扫描。
- 目标不在已核对范围内，或落在私网、云 metadata、相邻域名、未授权端口：拒做，记 PENDING 并写明原因。
- 卡片里带 `disallowed-tools`（`rm` / `curl` / `wget` / `nmap` / 写 `.env` 等）的动作：那是该技能自带的硬约束。
  本引擎不解释 Claude Code 的 allowed-tools 字段，所以这条要由执行时自我约束，不得当成"没被强制就可以做"。
- 指纹、配置项、缺失的响应头本身不是漏洞，不得写成 finding；只有可复现的证据链才进报告。
- 无法复现或未取到一手证据的结论：标 INFO/PENDING，不升级为风险等级。
