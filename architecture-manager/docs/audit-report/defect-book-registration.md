# 缺陷状态簿登记记录（P8 chain 执行凭据）

- **执行时间**：2026-10-10 10:47（用户确认「确认登记」后放行）
- **执行方式**：`node docs/audit-report/build-defect-plans.mjs docs/audit-report/defect-rows.json chain`——19 条 build→applyPlan 串行事务，全部走应用治理流（buildDefectBookEditPlan + applyPlan：requirePlan 断言 → SHA 基线 → saveCheckpoint → atomicWrite → 写后 SHA 复核 → 审计链），**零手写 JSON**。
- **目标簿**：`E:/ai/versions/缺陷状态簿.json`
- **基线 book SHA256**：`e2d9743ce292fe5de7291ff678ff9abd31462b67bab4b7d62649d23ee1649ea8`（执行前复核未变，无 EXTERNAL_CHANGE）
- **终版 book SHA256**：`51322f3b571f8bdd676ab35eb8d56eb423838bc42c2311bd52ac73b2075e3ff7`
- **登记条数**：19（AUD-D-001 ~ AUD-D-019）；状态分布 open ×2 + unverified-registration ×17；簿内缺陷总数 139 条。
- **链完整性**：已验证——每条 newSha256 == 下一条 checkpointSha256，末条 newSha256 == 终版 book SHA；D-013~D-019 与 chain 执行 stdout 逐字段一致。结构化凭据：`chain-transactions.json`。

## 逐条事务凭据

| 缺陷 ID | 状态 | planId | transactionId | checkpointSha256（写前） | newSha256（写后） |
|---|---|---|---|---|---|
| AUD-D-001 | open | `defect-book-append-20261010024701075` | `defect-book-append-20261010024701075-20261010024701115-de92003a` | `e2d9743ce292fe5d…` | `b3d7d6bca2933302…` |
| AUD-D-002 | open | `defect-book-append-20261010024701188` | `defect-book-append-20261010024701188-20261010024701194-bd73b4e7` | `b3d7d6bca2933302…` | `53db829936c403fe…` |
| AUD-D-003 | unverified-registration | `defect-book-append-20261010024701233` | `defect-book-append-20261010024701233-20261010024701239-3ba5de38` | `53db829936c403fe…` | `451e4fede67b7d75…` |
| AUD-D-004 | unverified-registration | `defect-book-append-20261010024701266` | `defect-book-append-20261010024701266-20261010024701270-d898f42d` | `451e4fede67b7d75…` | `23a53f7d5a53788b…` |
| AUD-D-005 | unverified-registration | `defect-book-append-20261010024701295` | `defect-book-append-20261010024701295-20261010024701299-94738fdc` | `23a53f7d5a53788b…` | `202a65254a6b6466…` |
| AUD-D-006 | unverified-registration | `defect-book-append-20261010024701324` | `defect-book-append-20261010024701324-20261010024701328-70f0e164` | `202a65254a6b6466…` | `a45c7e8d1cadbe09…` |
| AUD-D-007 | unverified-registration | `defect-book-append-20261010024701353` | `defect-book-append-20261010024701353-20261010024701356-3a9c9111` | `a45c7e8d1cadbe09…` | `deb6fb888623ef51…` |
| AUD-D-008 | unverified-registration | `defect-book-append-20261010024701387` | `defect-book-append-20261010024701387-20261010024701390-de9cf7ff` | `deb6fb888623ef51…` | `5e4de6f19f6425ff…` |
| AUD-D-009 | unverified-registration | `defect-book-append-20261010024701416` | `defect-book-append-20261010024701416-20261010024701420-d8d71969` | `5e4de6f19f6425ff…` | `31643064a89feb51…` |
| AUD-D-010 | unverified-registration | `defect-book-append-20261010024701453` | `defect-book-append-20261010024701453-20261010024701462-6c51a6c1` | `31643064a89feb51…` | `7fda1826f25dd577…` |
| AUD-D-011 | unverified-registration | `defect-book-append-20261010024701490` | `defect-book-append-20261010024701490-20261010024701494-7d9d3ed1` | `7fda1826f25dd577…` | `ba7af41661763a6f…` |
| AUD-D-012 | unverified-registration | `defect-book-append-20261010024701522` | `defect-book-append-20261010024701522-20261010024701526-3af7fd49` | `ba7af41661763a6f…` | `762dfbc6a551e25d…` |
| AUD-D-013 | unverified-registration | `defect-book-append-20261010024701552` | `defect-book-append-20261010024701552-20261010024701556-841ef5fa` | `762dfbc6a551e25d…` | `538c95198c0cde1e…` |
| AUD-D-014 | unverified-registration | `defect-book-append-20261010024701582` | `defect-book-append-20261010024701582-20261010024701587-a1b31ff8` | `538c95198c0cde1e…` | `b1243a5c577cae5e…` |
| AUD-D-015 | unverified-registration | `defect-book-append-20261010024701615` | `defect-book-append-20261010024701615-20261010024701619-38ddde27` | `b1243a5c577cae5e…` | `a320a992668c1811…` |
| AUD-D-016 | unverified-registration | `defect-book-append-20261010024701643` | `defect-book-append-20261010024701643-20261010024701647-06a67adc` | `a320a992668c1811…` | `10a0d941a3a149db…` |
| AUD-D-017 | unverified-registration | `defect-book-append-20261010024701675` | `defect-book-append-20261010024701675-20261010024701679-0bdf6977` | `10a0d941a3a149db…` | `702a5371ea990b94…` |
| AUD-D-018 | unverified-registration | `defect-book-append-20261010024701706` | `defect-book-append-20261010024701706-20261010024701709-436c8c01` | `702a5371ea990b94…` | `1499a842f62049a2…` |
| AUD-D-019 | unverified-registration | `defect-book-append-20261010024701734` | `defect-book-append-20261010024701734-20261010024701739-14275ce6` | `1499a842f62049a2…` | `51322f3b571f8bdd…` |

（SHA 全文见 chain-transactions.json；checkpoint 文件留存于 %LOCALAPPDATA%/ArchitectureManager/audit/checkpoints/）

## 终验提示

- `verifyDefectBook`（python 校验器）需在用户终端或管理台执行，作为登记终验。预期校验通过且终版 SHA = `51322f3b…`。

---

## 附：审计项目 P1–P8 全部交付物清单（收口）

**提交链（全部仅限 docs/audit-report/）**：

| commit | 内容 |
|---|---|
| 397bf800 | P1-P2 静态层+动态层证据（p1-hygiene-report、coverage-map-v2、测试/覆盖率/npm-audit/conform 原始证据） |
| 7f188d18 | 权威 conform digest 回填 P1-P2 报告 |
| 41e36f67 | R0 走查记录（进程 spawn / 凭据） |
| b5e4e91e | R1 走查记录（git 执行 / 事务内核） |
| e7bf7261 | R2+R3 走查记录（文件树 / paths & IPC 边界） |
| b739dd64 | R4 走查记录（onboarding 流水线 / 认证） |
| 71783e92 | R5+R6 走查记录 + P3-P7 终版汇总 |
| d643538d | P8 缺陷清单定稿 + 状态簿登记准备（defects-final、defect-rows、build-defect-plans、plan#1 凭据） |
| 1afe61e5 | 缺陷计数更正（19 项）+ conform ok:true 权威证据回填 |
| 本次 | 本登记记录 + chain-transactions.json |

**文件清单（docs/audit-report/，30 文件）**：
- 报告：p1-hygiene-report.md、coverage-map-v2.md、walkthrough-r0.md、walkthrough-r1.md、walkthrough-r2-r3.md、walkthrough-r4.md、walkthrough-r5-r6.md、audit-final-p3-p7.md、defects-final.md、本文件
- 数据：defect-rows.json、defect-plan-1.json、chain-transactions.json、coverage-src-rows.json、ref-graph.json、npm-audit-raw.json
- 工具：build-defect-plans.mjs、ref-graph.mjs、eslint-audit.config.mjs、eslint-recommended.json
- 证据：test-run-tap.txt、coverage-run.txt、eslint-recommended.stderr、conform-evidence/（conform.json + lint/preload/tests stdout·stderr 共 8 文件）

**结论**：P1–P8 全部收口。0 个 P0/P1 缺陷；19 项缺陷（P2×1 确认 + P3×18）已全部经应用事务流登记入缺陷状态簿。沙箱遗留事项（spawnSync EBUSY）已由真实环境 conform ok:true 权威读数（274 pass / 0 fail / 2 skip，digest 6cc9e253…）销项。
