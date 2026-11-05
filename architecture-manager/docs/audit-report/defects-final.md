# 审计终版《缺陷清单》（architecture-manager v0.8.1 · P8 定稿）

- 定稿人：QA 严过关 ｜ 审计基线 HEAD：40820c1f（ui-p5）｜ 定稿日期：2026-10-10
- 覆盖：审计全周期（P1 静态层 + P3–P7 人工走查 R0–R6）；权威测试基线 273/276（唯一失败为环境 electron.exe ENOENT，非缺陷）
- 合计 **19 项**：P2×1（确认）+ P3×18。P0/P1：**0 项**。（注：P1 阶段曾把环境性事项占号 D-003，终版中 D-003=R0 的 atomicGit flag 残留，环境事项不属缺陷未入清单。）
- 状态簿登记约定：**确认级（D-001/D-002）登记 status=open；线索级登记 status=unverified-registration**（复用缺陷状态簿自身语义：未经验证证据的登记为红色待核）。

## 一、全表（按级别排序，D-001 置顶）

### P2（功能错误候选·确认级）

**D-001** ｜ 置信度：确认（eslint no-dupe-keys + 人工读码双证据）
- 位置：`src/renderer/presenter.mjs:66-69`
- 证据链：同一对象字面量内 `IMPORT_GIT_BASELINE_REQUIRED`（66 行、68 行）与 `IMPORT_EXTERNAL_CHANGE`（67 行、69 行）键重复；JS 对象字面量后值静默覆盖前值，故 66/67 行文案不可达（eslint-recommended.json 三处 E 级 no-dupe-keys 中的两处，人工核对文本确实不同）。
- 影响：Git 基线未建立与外部变更两类错误的用户提示口径错乱——用户看到的文案取决于键书写顺序而非错误场景，66/67 行的开发意图文案永不显示。
- 修复建议：去重并为两种场景分配独立键名（两段文案语义不同：前者要求"先提交建立可回滚基线"，后者要求"重新读取生成计划"），或产品确认仅保留一段后删除另一段；补映射表防重回归用例（见附录 §2 第 7 条）。

### P3（边界/质量问题）

**D-002**（确认）｜ presenter.mjs:194,205 ｜ `RELEASE_SEMVER_INVALID` 键重复，两处文本相同，无行为影响，删除一处即可。

**D-003**（线索·中）｜ infrastructure/process-scope.mjs:22 ｜ atomicGit 取消 flag `atomic-<uuid>.flag` 写入平台根目录，控制器崩溃时无清理，随使用累积。建议：正常退出回收自身 flag 或移入 runtime/tmp。

**D-004**（线索·中）｜ core/owned-process.mjs:15-16 ｜ 16MB 输出上限仅写 cancel flag，stdout/stderr 字符串持续拼接至子进程实际退出，极端情况下内存瞬时超限。建议：触发上限同时 child.kill()。

**D-005**（线索·中）｜ owned-process.mjs:18 + runtime/job_controller.py:70 + windows_job.ps1 ｜ 子进程真实退出码 124/125 被父层无差别映射为 timedOut/cancelled。建议：带外标记或约定保留码。

**D-006**（线索·高）｜ runtime/job_controller.py:44-45 ｜ 子进程不消费 stdin 即退出时 `stdin.write` 抛 BrokenPipeError 未捕获，控制器带 traceback 非结构化退出。建议：except BrokenPipeError 视为子进程提前退出。

**D-007**（线索·高）｜ runtime/credential_store.py:126-134 ｜ 每次 set 在 backupRoot 下新建 uuid 子目录（previous.json+credential.json+MANIFEST.json），无清理无上限（均为 DPAPI 加密值，无明文风险）。建议：按 reference 保留最近 N 份。

**D-008**（线索·高）｜ runtime/provision.py:150 ｜ `json.loads(run(...).splitlines()[-1])` 假定注册恢复命令输出末行必为 JSON，pip/venv 前缀告警会打破（保守方向失败）。建议：结构化落文件再读。

**D-009**（线索·中）｜ runtime/peer_dispatcher.py:29 ｜ `root / (body['requestId'] + '.json')` 拼路径未做本地白名单校验，依赖上游对 sequence/peer id 的 `^[a-z0-9][a-z0-9._-]*$` 校验（纵深防御缺口，非直达）。建议：dispatcher 内复读 ID 白名单。

**D-010**（线索·高）｜ infrastructure/process-scope.mjs:16 ｜ readonlyGit 白名单缺 `log`/`blame`/`worktree list` 等纯读子命令，配置 python 的平台这些命令也走完整控制器路径（仅性能开销，方向安全）。建议：补充白名单。

**D-011**（线索·中）｜ software-launch.mjs:64-96 ｜ `runtime/tmp/manager-launch` 下 response 证据文件按 planId 累积不清理；崩溃时一次性 `allowGuiLaunch:true` 配置副本可能残留。建议：纳入平台 runtime/tmp 清扫策略。

**D-012**（线索·中）｜ transactions/kernel.mjs:57-64,42 ｜ atomicWrite 与审计 events.jsonl appendFileSync 均无 fsync——掉电级故障可能丢审计尾部/留半文件（读侧已有 corrupt 分支兜底）。建议：关键写后 fdatasync 或记为已知边界。

**D-013**（线索·中）｜ transactions.mjs:263-323 ｜ 多文件事务（integration 主文件+companion+mirrors）恢复中途崩溃 → 混合态需人工凭 checkpoint 恢复（逐文件正确性已推演成立，仅缺"继续恢复"自动化）。建议：未来增加 recovery-plan 事务类型。

**D-014**（线索·高）｜ transactions/operation-audit.mjs:15 ｜ operation 级审计 target 解析仅取 path/platformId/resourceId，mcp-credential 落不到 reference（domain 级事件有，纯元数据精度）。建议：补字段。

**D-015**（线索·高）｜ core/paths.mjs:6-11 ｜ safeRelative 不拒 Windows 保留设备名（CON/PRN/AUX/NUL/COM1…）与尾部点/空格；包含检查兜底无越界，但创建类操作在极端命名下行为怪异。建议：增加保留名与尾点尾空格拒绝。

**D-016**（线索·加固·缺失=确认）｜ index.html（无 CSP meta）+ main.mjs（无 CSP 响应头）｜ CSP 全缺。渲染层实测零注入汇（dangerouslySetInnerHTML/innerHTML/eval/window.open 全 0，React 默认转义）+ sandbox/contextIsolation/权限全拒已就位 → 可利用性未证明，属纵深防御加固而非可达缺陷。建议：meta CSP（script-src 'self'，评估 React inline style 的 style-src 需求）。

**D-017**（线索·高）｜ onboarding-state.mjs:160 ｜ markOnboardingRecorded 直接 execFileSync git（只读三命令）绕过 process-scope，与进程纪律不一致（实际风险≈0）。建议：改走 gitRaw。

**D-018**（线索·中）｜ onboarding-state.mjs:65 ｜ 证据复用判据不统一：复用 steps 只保留 client-tool-loop，矩阵复用走 readFirstCertification/recovery 两条独立判据，可产生混合执行（每步独立验证，无正确性问题）。建议：统一判据入口。

**D-019**（线索·高/危害低）｜ releases.mjs:113 ｜ verifyRelease 用 `join(root, destination)` 直接拼路径未经 targetPath 归一，且 verifyPlanTarget 的 release 分支无 requirePlan 前置——与其余 verify* 不一致；只读面（返回布尔+路径串），无写入。建议：改 targetPath + 补 requirePlan。

## 二、附录：D2 定向补充用例建议（终版 7 条）

1. `core/paths.mjs` 专项：junction 祖先/大小写/8.3 短名/UNC/尾点尾空格/保留名（覆盖率证实分支仅 74%）。
2. `git-executor` 负向回归：以 `-` 开头的 branch/tag/remote 名（build 侧校验已在，补执行侧守护）。
3. `transactions` integration 多文件事务：mirror 第 N 个写失败后主文件+companion 回滚完整性。
4. `software-launch`：连接器非 JSON/超时/超 maxBuffer + tmp 目录清扫断言。
5. `onboarding-recovery`：own() 对指向工作区外的 junction。
6. `main.mjs` 116 IPC 入口 input 为 null/undefined 抽样。
7. presenter 错误码映射表防重回归（守护 D-001/D-002 修复）。

## 三、登记执行记录

见同目录 `defect-book-registration.md`（事务流 plan id / 事务结果 / checkpoint 摘要，登记后追加）。
