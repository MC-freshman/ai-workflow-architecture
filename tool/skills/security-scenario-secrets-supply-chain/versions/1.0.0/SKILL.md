# security-scenario-secrets-supply-chain

凭据泄露与依赖链：暴露文件、硬编码密钥、传递性漏洞、许可证合规

> 场景技能：`mastermind-bug-bounty` 的 `secrets-supply-chain` 场景选中它时，本文进提示词上下文。
> 正文不是新写的说明书——下面每段都逐字取自本场景要用的那张技能自己的 `description`
> （含 Use when / Threshold / Trigger）。合并只做两件事：哪些卡属于这一步、按什么顺序、
> 什么情况下必须停；**具体深度步骤不在本文里，按下述钉版原文现取**。

## 第 1 步 · novel-detecting-exposed-secrets-files-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-exposed-secrets-files-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Probe a target for accidentally-served secret-bearing files in the web root
— `.git/`, `.env`, `.DS_Store`, backup files, database dumps, key files,
CI configs, IDE configs.
Use when: post-deploy verification on a new release, or SOC2 auditor asked
"what's reachable in the web root that shouldn't be," or a bug-bounty
report hints at a leaked file.
Threshold: any of the canonical 40+ paths returns 200 OR returns a body
matching the expected fingerprint of the file type (e.g., `.git/HEAD`
returns content starting with `ref:` or a 40-char hex SHA).
Trigger with: "check exposed files", "git directory exposure",
"env file leak", "backup file scan".

## 第 2 步 · novel-scanning-for-hardcoded-secrets-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-scanning-for-hardcoded-secrets-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source-code tree for hardcoded credentials embedded in source
files: AWS access keys, GitHub tokens, Stripe keys, Slack tokens,
Anthropic API keys, OpenAI keys, JWT signing secrets, generic
base64-encoded passwords, RSA / SSH private keys, and high-entropy
string literals that pattern-match common credential shapes.
Use when: pre-commit gate before pushing a feature branch, audit
before SOC2, post-incident scan after a leak, or inheriting a
codebase you didn't write.
Threshold: any source file contains a string that matches a
canonical credential regex (AWS AKIA prefix, GitHub ghp_ prefix,
etc.) OR a string with Shannon entropy above 4.5 in a field
context (key=, token:, secret=).
Trigger with: "scan secrets", "credential scan", "find hardcoded
keys", "leak check".

## 第 3 步 · novel-tracing-transitive-vulnerabilities-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-tracing-transitive-vulnerabilities-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Build a dependency-tree map of a project (npm or Python) and trace
the path from each known-vulnerable transitive package back to one
or more direct dependencies. Identifies which direct-dep bump would
clear the most findings at once (highest-leverage upgrade), which
vulnerabilities are unreachable through any version bump and
require overrides or vendor-patch, and which CVEs sit at deep
transitive depth (3+ levels from a direct dep) where blast-radius
triage is hardest.
Use when: a multi-finding audit produces noise and you need to
prioritize, when planning a major dependency refresh, after an
upstream package compromise hits your tree (e.g. event-stream
flatmap-stream), or when an audit shows findings that automated
fix commands cannot auto-resolve.
Threshold: any HIGH or CRITICAL CVE reachable only through
transitive paths that no single direct-dep bump can clear.
Trigger with: "trace transitive vulns", "find dep paths", "SBOM
vuln trace", "which direct dep pulls this CVE".

## 第 4 步 · novel-checking-license-compliance-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-checking-license-compliance-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Audit a project's dependency licenses against an explicit policy
(allow-list / deny-list / review-required) and flag incompatibilities
before they ship to production. Reads SPDX license identifiers from
npm package manifests, Python METADATA / PKG-INFO files, and
pyproject.toml; classifies each license by family (permissive,
weak-copyleft, strong-copyleft, proprietary, unknown); detects
copyleft contamination and SPDX-incompatible license combinations.
Use when: pre-release legal review, M&A code-audit due diligence,
preparing an OSS attribution NOTICE file, or switching a project's
own license.
Threshold: any GPL-family license in a project declaring MIT or
Apache-2.0; any UNKNOWN-license package; any metadata-vs-source
license mismatch.
Trigger with: "check licenses", "license compliance audit",
"SPDX scan", "GPL contamination check".


## 停下来拒绝的情形

- 未拿到书面授权与范围（ROE）时：只做被动、本地、离线分析，不发任何外部请求；第 1 张卡未完成前不得进入扫描。
- 目标不在已核对范围内，或落在私网、云 metadata、相邻域名、未授权端口：拒做，记 PENDING 并写明原因。
- 卡片里带 `disallowed-tools`（`rm` / `curl` / `wget` / `nmap` / 写 `.env` 等）的动作：那是该技能自带的硬约束。
  本引擎不解释 Claude Code 的 allowed-tools 字段，所以这条要由执行时自我约束，不得当成"没被强制就可以做"。
- 指纹、配置项、缺失的响应头本身不是漏洞，不得写成 finding；只有可复现的证据链才进报告。
- 无法复现或未取到一手证据的结论：标 INFO/PENDING，不升级为风险等级。
