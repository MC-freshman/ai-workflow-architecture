# 走查记录 R2+R3：文件树安置/备份/恢复 + 路径与 IPC 边界档（审计 P5）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f ｜ 日期：2026-10-10
- 方式：纯静态读码走查（无动态执行）
- 覆盖文件：R2=`domains/intake/publication.mjs`(229)、`software-intake.mjs`(161)、`software-publish.mjs`(284)、`software-recovery.mjs`(107)、`infrastructure/archive-tool.mjs`(12)、`workspace-bootstrap.mjs`(67)；R3=`core/paths.mjs`(46)、`main.mjs`(329，116 个 IPC 入口)、`index.html`、渲染层注入面 grep、`inventory.mjs` 抽查（normalizeRoot/inspectPlatformDirectory）

## 检查项与结论

### R2 文件树域

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| ZIP/备份解包路径安全 | **PASS**：restore_env.unpack 三重检查（绝对路径/`..`/反斜杠）；archive-tool 在 Windows 强制 System32 bsdtar 绝对路径（规避 Git Bash GNU tar 把盘符当 remote host 的经典坑，注释明确） | restore_env.py:14-19；archive-tool.mjs |
| 导入事务（publication） | **PASS**：journal 状态机（prepared→body-staged→validated→released-awaiting-registration→complete）+ planDigest 绑定 + pid 活性锁（wx 创建+expired 归档）+ 每文件写前/写后 SHA 双查 + staging 同卷 rename 原子发布 + 中断后可重入（interrupted 状态重跑主流程，changes current 必须=before 或 after）+ 敏感字面量检查（RAW_SECRET_NOT_ALLOWED）+ registry/catalog 变更白名单（IMPORT_MUTATION_NOT_ALLOWED/FOREIGN_*） | publication.mjs 全文 |
| 软件安置（software-intake） | **PASS**：源哈希全量预扫（拒绝 symlink/特殊文件类型）→ 双份落盘（backup stage + body stage）→ assertRows 逐文件复核 → renameOwnedDirectory 原子提交 → 失败路径 removeOwnedDirectory 按期望哈希表验证后删除（外部变更拒绝恢复）；copyRows 'wx' 拒覆盖 + 短写循环正确 | software-intake.mjs:42-148 |
| 配方发布（software-publish） | **PASS**：plan 重放三重比对（registry/connector/pointer 文本 SHA + 发布文件 JSON 全等）+ 已发布后健康检查失败仅降级 pending-verification（不阻塞、不虚报）+ 回滚覆盖 release 目录（按期望哈希删除）与 registry/connector/pointer 三文件 | software-publish.mjs:185-270 |
| 撤销（software-revert） | **PASS**：checkpoint 必须位于 auditRoot/checkpoints 内且 .before 后缀 + SHA 对账审计事件（SOFTWARE_CHECKPOINT_CHANGED 防篡改）；import 撤销=移入 inbox/trash（可逆），审计失败回滚 rename | software-recovery.mjs:35-94 |
| 克隆（workspace-bootstrap） | **PASS**：remote 白名单正则（https/git@/file:///盘符，拒 `-` 前缀=无选项注入面）；staging 前缀+同目录校验后清理；空目录检查在 rename 前复验；`rmdirSync` 仅限空目录 | workspace-bootstrap.mjs:19-67 |

### R3 路径与 IPC 边界

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| core/paths.mjs 专项（junction/大小写/8.3/UNC） | **PASS（附 2 条 P3 线索）**：① UNC `\\srv\share` → normalize 后以 `//` 开头被拒；② 逐级祖先 lstat 拒 symlink——Node/libuv 在 Windows 将 junction 报告为 symlink（isSymbolicLink()===true），代码另有 mode&0o170000===0o120000 双保险；③ 8.3 短名经 realpathSync 归一后进 relative 比对，指向工作区外即拒；④ 大小写：path.win32.relative 前缀比较不区分大小写；⑤ 叶存在则 realpath 后再验 rel（叶软链指外=拒）。**覆盖率分支缺口主要在 ENOENT/ENOTDIR catch 与盘符正则边角**，建议 D2 专项单测 | paths.mjs:6-35 |
| IPC 入参（main.mjs 117 handler 抽查） | **PASS（附观察）**：全部经 `operationRegistrar` 声明式注册（116 declared ops，frozen-preload/ui-operation-regression 测试锁一致性）；对话框类入口（workspace:select 等）不接收渲染层路径；`platform:inspect` 的 directoryRelative 经 resolve+realpath+relative 包含检查且必须等于已注册平台目录（inventory.mjs:114-121）；`workspace:scan` 接受任意存在目录（normalizeRoot 只验证存在性）——**设计即如此**（用户自选工作区），scan 为只读列目录；写操作全部走 plan 确认流 | main.mjs:111-288；inventory.mjs |
| Electron 配置 | **PASS**：contextIsolation:true / nodeIntegration:false / sandbox:true / setPermissionRequestHandler 全拒 / setWindowOpenHandler deny / 仅加载本地 dist/index.html | main.mjs:290-316 |
| CSP | **缺失（见 D-016）**：index.html 无 CSP meta，main.mjs 无 onHeadersReceived | index.html 全文 |
| 渲染层注入面 | **PASS（未发现注入汇）**：全 renderer grep `dangerouslySetInnerHTML/innerHTML/document.write/eval/new Function/window.open/href=` **0 命中**；React 默认转义；无 shell.openExternal（仅 openPath 打开本机目录） | grep 实测 |

## 缺陷候选

| ID | 级别 | 位置 | 证据/复现条件 | 影响 | 建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-015 | P3·线索 | `core/paths.mjs:6-11` | safeRelative 不拒 Windows 保留设备名（CON/PRN/AUX/NUL/COM1…）与尾部点/空格（`file.`、`file `），此类路径在 targetPath 通过校验后由 NT 对象管理器静默改写或拒绝 | 创建类文件操作在极端命名下行为怪异（失败或落盘名与计划不符）；无安全越界（包含检查兜底） | safeRelative 增加保留名与尾点/尾空格拒绝 | 高（规则缺省确证，触发需刻意命名） |
| D-016 | P3·线索（纵深防御） | `index.html`（无 CSP meta）+ `main.mjs`（无 CSP 响应头） | CSP 全缺；但渲染层实测**零注入汇**（无 dangerouslySetInnerHTML/innerHTML/eval/window.open，React 默认转义），且沙箱+contextIsolation+权限全拒已就位——可利用性未证明 | 若未来引入任一 XSS 缺陷，116 个 IPC 面（含 workspace:clone 写操作）对渲染层脚本敞开，无第二道防线 | 加 `Content-Security-Policy` meta（script-src 'self'; 需评估 React inline style 的 style-src 放宽范围）；属加固非修复 | 高（缺失确证）/低（危害需未来缺陷配合） |
| 观察 | — | `software-publish.mjs:161,174` | checkPublished 硬编码 `'python'`（PATH 解析）而非平台注册解释器，与 R0 "解释器路径来自配置"的口径不一致；结果保守（失败→pending-verification，不阻塞不虚报） | 诊断性检查可能因 PATH python 版本不符而误报 pending | 复用 runnerConfig/平台 python 绑定 | 高 |
| 观察 | — | `publication.mjs:109` | releaseLock=()=>unlinkSync(lock) 无容错：AV 占用时 finally 抛错会掩盖原始错误（方向安全：事务已回滚） | 错误信息降级 | unlink 失败降级为警告 | 高 |

## 档位结论
R2/R3 未发现 P0/P1。文件树域的"备份→真实恢复→原子提交→按哈希回滚"范式在 4 个子系统（publication/software-intake/software-publish/software-revert）中一致成立；IPC 面声明式注册+写操作全走 plan 确认流的设计经抽查成立。CSP 缺失为最重要加固项（D-016），但因零注入汇降为 P3。
