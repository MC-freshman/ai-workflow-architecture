# security-scenario-surface-hygiene

暴露面卫生：CORS、响应头、TLS 与证书、弱加密、目录列举、调试端点、组件指纹

> 场景技能：`mastermind-bug-bounty` 的 `surface-hygiene` 场景选中它时，本文进提示词上下文。
> 正文不是新写的说明书——下面每段都逐字取自本场景要用的那张技能自己的 `description`
> （含 Use when / Threshold / Trigger）。合并只做两件事：哪些卡属于这一步、按什么顺序、
> 什么情况下必须停；**具体深度步骤不在本文里，按下述钉版原文现取**。

## 第 1 步 · novel-auditing-cors-policy-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-auditing-cors-policy-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Audit a target's CORS posture — Access-Control-Allow-Origin handling,
reflected-origin bypass, credentials+wildcard mismatch, preflight
OPTIONS behavior, Vary header correctness.
Use when: a third-party integration is failing CORS preflight and
someone proposes "just set Allow-Origin to *" as the fix, OR your
bug-bounty inbox has a credential-reuse exploit chain.
Threshold: any reflection of arbitrary Origin into Allow-Origin,
Allow-Credentials:true with wildcard origin (browser-rejected combo
but server config wrong), missing Vary:Origin on per-origin responses,
preflight cached over 86400s, OR Allow-Origin trust of attacker-
controlled subdomain pattern.
Trigger with: "audit cors", "check cors policy", "cors bypass",
"preflight check".

## 第 2 步 · novel-checking-http-security-headers-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-checking-http-security-headers-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Audit a target's HTTP security headers — CSP, HSTS, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and the
Cross-Origin trio (COOP, COEP, CORP).
Use when: SOC2 / PCI auditor flagged "missing security headers" or a
Mozilla Observatory grade is below B, OR you need HSTS preload
eligibility for chrome://net-internals.
Threshold: any missing required header on production HTML response,
HSTS max-age below 31536000s (preload requirement), CSP with
'unsafe-inline' or 'unsafe-eval', X-Frame-Options absent AND CSP
frame-ancestors absent (clickjacking), Cache-Control allowing public
cache on authenticated endpoint.
Trigger with: "audit security headers", "check csp", "hsts check",
"header posture".

## 第 3 步 · novel-analyzing-tls-config-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-analyzing-tls-config-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Analyze a target's TLS configuration — negotiated protocol version, cipher
suite, certificate chain, expiry, and downgrade vectors.
Use when: SOC2 auditor flagged your endpoint for "weak TLS" but you don't
know which control failed (TSC CC6.7 transmission integrity vs CC6.6
encryption) or which cipher is the problem.
Threshold: any negotiated TLSv1.0 or TLSv1.1, OR a cipher with RC4 / 3DES /
null / EXPORT, OR a cert with under 30 days to expiry, OR a chain that fails
hostname verification.
Trigger with: "audit tls", "check ssl config", "weak tls", "analyze tls".

## 第 4 步 · novel-detecting-ssl-cert-issues-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-ssl-cert-issues-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Audit a target's TLS certificate beyond protocol/expiry — chain ordering,
OCSP stapling, revocation status, Certificate Transparency presence,
key-usage flags, and over-broad wildcards.
Use when: TLS handshake already passes (skill #1 analyzing-tls-config
cleared) but you suspect the cert posture is fragile. Auditors flag this
during SOC2 readiness when a renewal slipped or an intermediate was
rotated.
Threshold: missing OCSP stapling on production, fewer than 2 SCTs in
the cert, intermediate served out of order, key usage missing
digitalSignature/keyEncipherment, revoked cert presented, or wildcard
scope of 2-level (e.g., *.com is rejection; *.api.example.com is fine).
Trigger with: "check cert revocation", "audit ocsp", "ct log check",
"cert chain audit".

## 第 5 步 · novel-detecting-weak-cryptography-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-weak-cryptography-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Scan a source tree for weak cryptographic primitives: MD5 / SHA-1
used for security purposes, DES / 3DES / RC4 ciphers, ECB block
mode, custom-built crypto (XOR loops, hand-rolled HMAC),
hardcoded IVs, predictable random (Math.random / java.util.Random
for crypto seeds), missing certificate verification
(verify=False, rejectUnauthorized: false).
Use when: pre-merge gate on crypto-touching code, audit before
SOC2 / PCI assessment, post-incident review when "we found a
weakness in our token signing."
Threshold: any call to a known-weak algorithm with non-test
context, OR cert verification explicitly disabled, OR a custom
crypto loop pattern.
Trigger with: "scan weak crypto", "find MD5 usage", "check ECB
mode", "audit ssl verify", "weak random".

## 第 6 步 · novel-detecting-directory-listing-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-directory-listing-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Probe a target for directories that return auto-generated index
listings instead of denying or serving a specific file — exposes
the full file tree under any reachable directory, including files
the application never linked to.
Use when: post-deploy verification on a static-asset host, security
audit before SOC2, or following up on a finding from skill #6
(exposed-files) where a backup-file path returned 200 with HTML
body instead of the expected file content (suggests autoindex
serving a directory listing).
Threshold: any directory-shaped path returns 200 with HTML body
matching the framework-specific autoindex fingerprint (nginx
fancyindex, Apache mod_autoindex Index of/, Caddy browse, Lighttpd
mod_dirlisting, etc.).
Trigger with: "directory listing check", "autoindex detection",
"open directory scan".

## 第 7 步 · novel-detecting-debug-endpoints-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-detecting-debug-endpoints-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Probe a target for accidentally-public admin / debug / introspection
endpoints — Spring Boot Actuator, Apache server-status, Prometheus
metrics, GraphQL playground, Swagger UI, phpMyAdmin, JMX-over-HTTP
(Jolokia), Elasticsearch _cat, Kibana / Grafana / Eureka / Consul
panels.
Use when: post-deploy verification, security audit before SOC2,
inheriting a system you didn't build, or a bug bounty hints at an
exposed introspection panel.
Threshold: any of the canonical 40+ admin/debug paths returns 200,
302 to a login, or framework-specific JSON shape (e.g., Actuator
returning a _links object, server-status HTML body containing
the Apache Server Status title).
Trigger with: "check debug endpoints", "actuator exposure", "admin
panel scan", "graphql playground check".

## 第 8 步 · novel-fingerprinting-server-software-security@1.0.0

现取（只读；版本已随本次 run 入锁）：`tool/skills/novel-fingerprinting-server-software-security/versions/1.0.0/SKILL.md`
该卡章节：Overview / When the skill produces findings / Prerequisites / Instructions / Examples / Output

> 以下 `description` 为该卡原文逐字：

Identify the server software, framework, and component versions a
target is running from its HTTP response signatures — Server header,
X-Powered-By, Via, X-AspNet-Version, X-Runtime, X-Drupal-Cache,
X-Generator, Set-Cookie name patterns, error-page artwork,
HTTP method behavior signatures.
Use when: penetration test reconnaissance phase, post-deploy audit
of fingerprintable exposure, or before reporting "no obvious version
disclosure" to an auditor.
Threshold: any version string in a response header (e.g.,
Server header with nginx/1.18.0, X-Powered-By with PHP/7.4.21,
X-Generator with Drupal 9), or any framework-default Set-Cookie
name (PHPSESSID, JSESSIONID, connect.sid, _csrf_token).
Trigger with: "fingerprint server", "version disclosure",
"tech-stack identification", "what's this site running".


## 停下来拒绝的情形

- 未拿到书面授权与范围（ROE）时：只做被动、本地、离线分析，不发任何外部请求；第 1 张卡未完成前不得进入扫描。
- 目标不在已核对范围内，或落在私网、云 metadata、相邻域名、未授权端口：拒做，记 PENDING 并写明原因。
- 卡片里带 `disallowed-tools`（`rm` / `curl` / `wget` / `nmap` / 写 `.env` 等）的动作：那是该技能自带的硬约束。
  本引擎不解释 Claude Code 的 allowed-tools 字段，所以这条要由执行时自我约束，不得当成"没被强制就可以做"。
- 指纹、配置项、缺失的响应头本身不是漏洞，不得写成 finding；只有可复现的证据链才进报告。
- 无法复现或未取到一手证据的结论：标 INFO/PENDING，不升级为风险等级。
