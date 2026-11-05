# 审计终版报告：P3–P7 人工走查汇总（architecture-manager v0.8.1 · R0–R6）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f（ui-p5 冻结）｜ 日期：2026-10-10
- 走查记录：walkthrough-r0.md（41e36f67）、walkthrough-r1.md（b5e4e91e）、walkthrough-r2-r3.md（e7bf7261）、walkthrough-r4.md（b739dd64）、walkthrough-r5-r6.md（本提交）
- 权威测试基线：真实环境 276 例 = 273 pass / 1 fail（electron.exe ENOENT，环境已认领）/ 2 skip（平台门控）；digest c1f2bbc3…

## 一、总结论

**R0–R6 六档人工走查全部完成，未发现任何 P0（数据丢失/安全）或 P1（功能错误）缺陷。**
- 三大安全红线经全链路读码确认成立：①凭据值不落计划/审计/日志/回执；②Git 操作全参数数组化+显式路径+双重敏感扫描+拒 force+HEAD 陈旧拒绝；③写事务统一"SHA 基线→checkpoint→原子写→读回验证→按哈希回滚"范式。
- 渲染层零注入汇（无 dangerouslySetInnerHTML/innerHTML/eval/window.open），D-016（CSP 缺失）因此维持 P3 加固定位。
- P1 方案阶段的 8 条初步线索：**2 条销项**（④ git ref 校验存在；⑤⑥归并为 D-011/D-015 具体化），**1 条升级为确认缺陷**（① CSP 缺失 → D-016），其余 5 条保持线索并具体化。
- 全部缺陷候选共 **19 项在册（D-001~D-019 连续编号）**：P2×1（确认）、P3×18（线索/确认混合）。分布与证据链见下表。

## 二、缺陷候选汇总表（P8 缺陷状态簿登记的输入）

| ID | 级别 | 位置 | 摘要 | 置信度 | 来源档 |
|---|---|---|---|---|---|
| D-001 | **P2·确认** | src/renderer/presenter.mjs:66-69 | 重复键 IMPORT_GIT_BASELINE_REQUIRED/IMPORT_EXTERNAL_CHANGE 文案互覆，前值永不可达 | 确认（eslint+读码双证据） | P1 静态层 |
| D-002 | P3·确认 | presenter.mjs:194,205 | RELEASE_SEMVER_INVALID 重复键（同文本，卫生） | 确认 | P1 静态层 |
| D-003 | P3·线索 | infrastructure/process-scope.mjs:22 | atomicGit 取消 flag 残留 cwd 无清理 | 中 | R0 |
| D-004 | P3·线索 | core/owned-process.mjs:15-16 | 16MB 上限只发 cancel 不杀进程，stdout 仍累积 | 中 | R0 |
| D-005 | P3·线索 | owned-process.mjs:18 + job_controller.py:70 + windows_job.ps1 | 子进程真实退出码 124/125 与超时/取消语义冲突 | 中 | R0 |
| D-006 | P3·线索 | runtime/job_controller.py:44-45 | 子进程不读 stdin 时 BrokenPipeError 未捕获 | 高 | R0 |
| D-007 | P3·线索 | runtime/credential_store.py:126-134 | set 凭据备份 uuid 目录无清理/上限 | 高 | R0 |
| D-008 | P3·线索 | runtime/provision.py:150 | 注册恢复输出尾行 JSON 假设脆弱 | 高 | R0 |
| D-009 | P3·线索 | runtime/peer_dispatcher.py:29 | requestId 拼路径缺纵深白名单（依赖上游 ID 校验） | 中 | R0 |
| D-010 | P3·线索 | infrastructure/process-scope.mjs:16 | readonlyGit 白名单缺 log/blame 等纯读命令（仅性能） | 高 | R0 |
| D-011 | P3·线索 | software-launch.mjs:64-96 | manager-launch 临时目录残留（崩溃时含 allowGuiLaunch:true 副本；response 证据累积） | 中 | R0 |
| D-012 | P3·线索 | transactions/kernel.mjs:57-64,42 | atomicWrite/审计 JSONL 无 fsync（掉电级持久性缺口） | 中 | R1 |
| D-013 | P3·线索 | transactions.mjs:263-323 | 多文件事务恢复中途崩溃 → 混合态需人工 checkpoint（已知边界） | 中 | R1 |
| D-014 | P3·线索 | transactions/operation-audit.mjs:15 | operation 级审计 target 解析缺 reference 等字段 | 高 | R1 |
| D-015 | P3·线索 | core/paths.mjs:6-11 | safeRelative 不拒 Windows 保留设备名/尾点尾空格 | 高 | R2 |
| D-016 | P3·线索（加固） | index.html + main.mjs | CSP 全缺；渲染层零注入汇，纵深防御缺口非可达缺陷 | 缺失=确认 | R3 |
| D-017 | P3·线索 | onboarding-state.mjs:160 | markOnboardingRecorded 绕过 process-scope 直调 git（只读） | 高 | R4 |
| D-018 | P3·线索 | onboarding-state.mjs:65 | 证据复用双判据不统一（效率/可解释性） | 中 | R4 |
| D-019 | P3·线索 | releases.mjs:113 | verifyRelease 路径未经 targetPath 归一（只读面，与其余 verify 不一致） | 高 | R5 |

另：D-003（环境，Node 22 vs engines>=24）在 P1 报告占号，与上表独立；环境性事项均已闭环（权威 digest 覆盖）。

## 三、与现有质量门的关系（纪律确认）
- 现有 65 测试/conform/eslint 配置/defects 机制零改动；本批次仅新增 docs/audit-report/ 下 6 份走查记录+本报告。
- P8 待派发：将上表 17 项按缺陷状态簿格式登记（走 buildDefectBookEditPlan 计划流，需用户确认 applyMode:confirmation-required）。

## 四、D2 定向用例建议（终版，7 条，详见 coverage-map-v2.md §4）
1. core/paths.mjs 专项（junction/8.3/UNC/尾点）——覆盖率证实分支缺口 74%；
2. git-executor 负向 ref 名（build 校验存在，补执行侧回归）；
3. integration 多文件事务中途失败回滚完整性（mirrors）；
4. software-launch 连接器异常路径 + 临时目录清扫；
5. onboarding-recovery own() 对外指 junction；
6. main.mjs IPC 入口 null/undefined 入参抽样；
7. presenter 错误码映射表防重回归（守护 D-001/D-002 修复）。
