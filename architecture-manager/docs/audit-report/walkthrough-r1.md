# 走查记录 R1：Git 执行与事务内核档（审计 P4）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f ｜ 日期：2026-10-10
- 方式：纯静态读码走查 + 多文件回滚推演（无动态执行）
- 覆盖文件：`git-executor.mjs`(112)、`git.mjs`(111)、`infrastructure/git.mjs`(7)、`domains/git/state.mjs`(22)、`domains/git/sensitive.mjs`(53，抽读)、`domains/git/backup.mjs`(95)、`transactions/kernel.mjs`(76)、`transactions/recovery.mjs`(37)、`transactions/operation-audit.mjs`(39)、`transactions/audit-content.mjs`(32)、`transactions/onboarding-files.mjs`(47)、`transactions.mjs` applyIntegration 多文件回滚推演

## 检查项与结论

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| git 选项/参数注入 | **PASS——P1 线索④销项**：branch/tag 名在 buildGitPlan 校验（`^[A-Za-z0-9._/-]{1,120}$` + 拒 `-` 前缀 + 拒 `..`，git.mjs:70/73）；remote 校验格式+必须在 `git remote` 列表（state.mjs:19-21）；commit SHA 校验 7-40 位 hex（git.mjs:79）；全部参数数组调用 | git.mjs、state.mjs |
| `git add` 红线 | **PASS**：validateStagedPaths 拒 `-A/--all/./../通配符/盘符/绝对路径/-` 前缀（git.mjs:94-109）；apply 时 add 后二次断言索引+scanIndex 双重敏感扫描（git-executor.mjs:42-44） | 同左 |
| push 红线 | **PASS**：`step.force!==false` 即拒（force:false 必须显式）；outgoing 敏感扫描阻断；push 后 verify 用 aheadCount===0 | git-executor.mjs:58-64,100-103 |
| HEAD 陈旧计划拒绝 | **PASS**：apply 前 rev-parse 与 plan.target.headBefore 全等比对（GIT_EXTERNAL_CHANGE）；rollback 双重脏树检查（plan 时+apply 时） | git-executor.mjs:28-29,67 |
| revert 失败清理 | **PASS**：失败自动 `revert --abort`（空 catch 有注释限定"no active revert"，判定合理） | git-executor.mjs:68-69 |
| **多文件事务回滚推演（integration 主文件+companion+mirrors）** | **推演结论：逐文件正确性成立**。①写前 TOCTOU 守卫：每个 mirror 写前重读比对 before SHA（transactions.mjs:314）；②失败路径调 restoreOwnedFiles，entries 含全部已写+未写文件；③recovery.mjs:9-16 预扫描：current 必须=before（跳过，未写文件正确回位）或=afterSha（可恢复），否则整体报冲突不部分恢复；④恢复前逐文件再校验（:21）；⑤逆写序恢复（:19）。**残余窗口**：恢复过程本身多文件非原子——若恢复中途崩溃（非外部写入），工作树处于混合态， recourse=checkpoint（auditRoot/checkpoints/<id>.before 保存了每文件 before 全文）可人工恢复 | transactions.mjs:263-323；recovery.mjs 全文 |
| restoreOwnedFiles 防御 | **PASS**：拒绝恢复 over 符号链接（:11）；绝不覆盖新外部字节（:21 注释即设计） | recovery.mjs |
| 审计事件完整性 | **PASS**：sanitizeAuditEvent 递归脱敏（传入 secrets 含 credentialValue，operation-audit.mjs:16）+ 模式化脱敏（password/bearer/URL 凭据/sk- key/PEM 私钥块）+ eventSha256 哈希链；成功但审计写失败 → AUDIT_FINALIZATION_FAILED 显式抛出（writePerformed 不丢失） | audit-content.mjs:3-12；operation-audit.mjs:30-32 |
| 备份真实性 | **PASS**：createGitBackup 每种模式都做真实恢复演练（snapshot: zip→解压→逐文件 SHA 比对；history: bundle→clone→checkout→staged patch apply 回读→working-tree 逐文件回放比对）；HEAD 树拒绝 symlink 条目（mode 120000，backup.mjs:15）；SHA256SUMS 全文件清单+verifyGitBackup 全量复验 | backup.mjs:26-95 |
| 计划幂等/外部变更阻断 | **PASS**：already-applied 分支、EXTERNAL_CHANGE_DETECTED 统一模式贯穿全部 6 个 apply 函数（transactions.mjs 抽验） | 同左 |

## 缺陷候选

| ID | 级别 | 位置 | 证据/复现条件 | 影响 | 建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-012 | P3·线索 | `transactions/kernel.mjs:57-64` + `kernel.mjs:42` | **持久性缺口**：atomicWrite 的 renameSync 前无 fsync；审计 events.jsonl 的 appendFileSync 亦无 fsync。进程崩溃（非断电）下 Windows 文件系统通常仍一致；断电/系统崩溃时可能丢尾部审计事件或留空/半文件 | 极端掉电场景丢审计尾部/损坏 JSONL 尾行（读侧 parseJson 会失败——已有 corrupt 分支） | 关键写后 fdatasync；或接受现状并记录为已知边界 | 中（机制确证，触发需掉电级故障） |
| D-013 | P3·线索 | `transactions.mjs:263-323`（applyIntegration） | 上述推演的残余窗口：恢复中途崩溃 → 主文件/companion/mirrors 混合态 | 需人工凭 checkpoint 恢复；无自动"继续恢复"入口 | 未来可加"恢复事务"计划类型（recovery-plan）自动重放 restoreOwnedFiles | 中（推演确证，未动态复现） |
| D-014 | P3·线索 | `transactions/operation-audit.mjs:15` | operation 级审计事件的 target 解析仅取 path/platformId/resourceId，mcp-credential 类计划落不到 reference（domain 级事件有，operation 级无） | operation 级事件定位精度略降（纯元数据，无泄漏——reference 本非机密） | target 解析补 reference/softywareId 等 | 高 |
| 观察 | — | `git.mjs:68` | commit steps 里记录了演示性 command 数组（含 '&&'），但执行器从不使用该字段（真正执行在 git-executor 分步调用）——纯展示字段，无注入面（不进 spawn） | 无 | 可在文案中说明其为展示用途 | 高（确认无风险，避免未来误用） |

## P1 线索销项记录
- **线索④（git ref 名校验疑缺）→ 关闭**：buildGitPlan 存在完整校验，git-executor 执行侧依赖 plan 已过 build 侧校验+apply 时 requirePlan schema 锁。执行器不做二次校验是分层设计而非缺陷（防御深度建议已在 D-009 同类中说明，不单独立项）。

## 档位结论
R1 未发现 P0/P1。Git 红线（显式路径、双敏感扫描、拒 force、HEAD 陈旧拒绝）与事务内核（requirePlan 三断言、SHA 基线、checkpoint、回滚、审计链）经逐行核对成立。多文件回滚的唯一残余是"恢复中途崩溃需人工 checkpoint 恢复"，属记录在案的已知边界而非缺陷。
