# 架构管理台 0.9.1 使用手册

Architecture Manager 是 Windows 本地工作区管理工具。它读取使用者的 tool、agent、software 三仓，先盘点和生成可核对的计划，再执行获准更新、接入、发布、备份和 Git 收口。0.8.7 起，安装包自带三仓当前版本的种子（seed），新空工作区在接入时自动铺放；模型账号、厂商客户端和第三方软件由使用者准备；EXE 启动成功不等于平台完整接入。

## 第一次使用

1. 运行安装版 setup（或便携 EXE），把工作区指向包含 `AGENTS.md` 的根目录。安装包自带三仓 seed：全新空工作区接入时自动铺放 tool/agent/software 当前版本（逐文件 SHA-256 校验，非空工作区只读评估、绝不覆盖）。
2. 到“平台与接入”创建或选择平台。接入计划自动生成缺失的平台配置与 wf/wfa 入口技能：有本地命令槽的平台（Codex/WorkBuddy/ZCode）直接渲染进槽位，已有文件按 kept-identical/kept-divergent 如实记录、绝不覆盖；没有槽位的平台（Doubao/Dsh/Qoder）把渲染好的文件放进 `<平台>/runtime/entry-skills-export/`，手动取用即可接入。
3. 接入以「能跑」为首要判据：L1 双格真实回执（1 条工作流 + 1 个专家经引擎 prepare→领取→stop）通过即记录「能用」。厂商原生回执默认按辅助项如实登记，不阻塞完成（owner ruling 2026-10-14，D-152 语义）。
4. 预览“一键接入／继续”，核对变化后执行。登录、UAC、许可证及厂商工具确认由本人完成。
5. 在厂商客户端加载该工作区的 MCP/命令/Skill，获取真实工具回执；仅文件存在、程序启动或 CLI 自测不代替客户端接通。

共享版本只读；环境、本体、凭据和 run 记录在所属平台 runtime。新增平台目录须明确授权。备份归所属平台登记并实际恢复核对，不把私人配置复制到其他平台。

## 0.8.14 新增（2026-10-29）

- **纯整理版，零功能变化**：功能、判据、数据结构与 0.8.13 完全一致。
- **构建残留清理**：`release-0812/`、`release-0813/`、`release-final/`、`release/` 内的历史包（0.8.7 / 0.8.8 / 0.8.11 / 0.8.12，GitHub 均有完整备份）与排查杂项已删；每个被清目录的 `app.asar` 被 WorkBuddy 宿主进程持锁（Restart Manager 查明 PID 为 WorkBuddy 自身），会话内删不掉，残留壳重启后可删。
- **域归位**：`src/` 顶层 37 个散文件归入 `domains/`（onboarding 15 / software 5 / git 2 / plans 2 / audit 2 / resources 2 / intake 2 / platforms 3 / docs 2 / workspace 1 / runs 1），`transactions.mjs` → `transactions/router.mjs`；顶层只留 `main.mjs` / `cli.mjs` / `preload.cjs` 三个入口。模块职责见 [module-map](docs/module-map.md)。
- **零行为变化证据**：全部 1,323 处相对 import 逐条重写并复验存在；三处 `import.meta.url` 资源定位（入口技能模板 / seed / provider 与客户端 Python）同步修正；会话内逐文件全量 94 文件 / 失败恰好 5 例，与 0.8.13 基线**逐例同名同数**（既有环境缺口）；两个生成物（`preload.cjs`、`platform_defaults.mjs`）重新生成后字节零漂移。
- **顺带**：`.gitignore` 增加 `release-*/` 与 `__pycache__/`；缺陷簿 35 处 location/source 归位（自检 ok=true）。

## 0.8.13 新增（2026-10-29）

- **D-166 修复：治理文件重命名不再让接入收口卡死。** 改名后收口提交必然抛 `GIT_UNRELATED_STAGED_FILES`（白名单记的是旧名，而 git 对重命名只报新名）。现在按重命名对判定：旧名属治理路径集合、新名属治理文本集合（`.md/.json/.py/.mjs`，不匹配凭据类命名，位于根级治理文档 / `versions/` / `<平台>/bridge/`）即放行，新名换进提交目标、源路径并入 `commit --only`（否则只提交目标会留下源，变成复制）。非法重命名与无关暂存**仍拒绝**。
- **D-162：表外客户端入口技能有了管理台侧通路。** 无本地命令槽的平台（qoder-cn / doubao 一类）额外导出与 qoder 同构的插件包（`.qoder-plugin/plugin.json` + `skills/{wf,wfa}/SKILL.md`），摘要给出 `pluginPackage`（路径、清单、技能、放置指引）。产物只落 `<平台>/runtime/entry-skills-export/`，**不写平台目录、不改客户端插件状态**；「客户端是否读取工作区级 `plugins/`」无法只读确认，故缺陷保持 open，不谎报可用。
- **环境校验预算不再被覆盖。** `verifyTimeoutSeconds` 原先写 backend 时硬编码 300，盖掉平台已声明预算：现在取值顺序为显式配置 > 平台既有声明 > 默认 300，取值域 1..3600（越界抛 `RUNTIME_VERIFY_BUDGET_OUT_OF_RANGE`）。探针证据跨轮复用属治理裁定，新登记为 D-173，本轮未做。
- **文档站补齐第七个平台**：根仓 `docs-site` 白名单新增 `platform-qoder-cn`（51 → 52 条），平台枚举 6 → 7（此前文档站另存一份六平台副本，是 G-5 的真根因）；`docs-conform` = PASS 11 / FAIL 0 / SKIP 0。
- **测试**：新增 7 例（预算解耦 4 例、入口技能插件包 3 例），另把 D-166 的现状用例改写为「合法放行 / 非治理目标仍拒 / 无关暂存仍拒」三例。

## 0.8.12 新增（2026-10-28）

- **D-170 修复：无本地命令位平台的接入记录不再一续跑就判非法。** 没有本地命令槽的平台（doubao / dsh / qoder / qoder-cn 及任何第七平台）会把渲染好的 wf/wfa 入口技能暂存到 `<平台>/runtime/entry-skills-export/`，而恢复校验的白名单此前只认 bridge 与几个固定路径，client 步一过就抛 `ONBOARDING_JOURNAL_INVALID`（两条哈希合法且与磁盘一致，纯属白名单漏项）。现在白名单放行该前缀，漂移只作废 client 及下游；顺带把记录键先归一化再比前缀，堵住 `../` 越界。
- **D-171 修复：资源环境下载连接可以在界面里配置。** 「一键更新所有平台」每平台新增资源下载源（镜像 index-url）、离线 wheelhouse 目录、可信主机三个输入，透传进资源环境 spec；仅 wheelhouse ⇒ 离线安装，有镜像 ⇒ 用镜像且索引仍可用。改了下载源重试不再被漂移判据挡住，同一安装目录继续复用；失败文案直接指向这三个入口。
- **D-172 修复：慢网下的资源包下载不再被固定时钟杀掉。** 改为进度感知超时：有输出或目录在增长就续期，只有**真的没有进展**超过 `idleTimeoutSeconds`（默认 900 秒）才停，另有 `maxSeconds`（默认 3600 秒）硬上限；顶部进度条显示已下载 MB 与 KB/s；已建的虚拟环境和已下载的 wheel 保留复用，pip 增加 `--timeout 60 --retries 10`；外层看门狗由 30 分钟提到 2 小时以上。
- **测试**：新增 9 例（入口技能导出件续跑 3 例、资源环境下载 6 例，其中 3 例用真解释器驱动慢速流与空闲超时）。

## 0.8.11 新增（2026-10-28）

- **「完全接入」有了唯一口径**（用户裁定）：完全接入 = 能够流畅跑通架构管理的所有步骤。此前 `architectureComplete` 这一个字段在五处各有一套公式，同一份入驻记录会被引擎给出三种答案（D-167 / D-168 / D-169，本版全部关闭）。现在统一由 `readAdoptionCompletion()` 单点产出：入驻记录状态 `complete`，且 11 步序列（配置与版本 / 隔离后端 / 运行环境 / 平台 provider / 服务通道 / 能力实测 / wf-wfa 真实调用收据 / 厂商原生 / 完整认证 / 治理登记 / Git 提交）**每一步都在档且状态属于「已通过」或「辅助项」**。
- **确立「最小接入」命名**：= platform 能正常通过 wf/wfa 调用 skill，依据 `l1-dual-cell` 收据。该术语此前在代码与文档里都不存在。
- **回读与校验同源**：`onboardingReadback` 与 `verifyAutomaticOnboarding` 对同一份记录给同一个答案（此前回读漏了辅助项豁免，而辅助项正是默认值）。三层读数的 L3 也改读同一函数，杜绝「三层全绿但完成读数拒绝」。
- **三仓对齐**：96 资源 / 896 文件哈希 0 失配；钉版矩阵 7 平台 14/14 与共享 current 一致；`tool` / `agent` README 与治理文本补齐第七个平台目录 `qoder-cn`。
- **测试**：接入全链路 10 例（nodejs / python+WSL / 平台本体含带空格的 `Qoder CN.exe` / software 四个发现面各有正反用例）、execute 脚本阶段 3 例、完成口径 7 例。全量权威读数 434 例 / 432 pass / 0 fail / 2 skip。
- **D-164 修复**：Node v24 已在进程 PATH 中却报 `MANAGEMENT_NODE_REQUIRED` 的误报已修，并区分「存在但无法启动」（`NODE_SPAWN_FAILED`）与「根本没装」（`NODE_NOT_FOUND`）。

## 0.8.7 新增

- **安装包自带三仓 seed**：collect-seed 收集三仓 current 指针面与 tool/skills 全文（12,057 文件）打进安装包；空工作区接入时逐文件校验铺放（`SEED_INTEGRITY_MISMATCH` 即停），非空工作区零写入。
- **wf/wfa 入口技能自动接入与兜底导出**：模板是唯一真身，渲染产物不入 git；槽位绝不覆盖，无槽位平台自动导出待取。
- **L1 双格「能用」回执**：接入流水线在能力探针后真实驱动 1 条工作流 + 1 个专家，作为「能跑」的机器判据；只随环境一起暂缓，configured-pending 工作区也带可用回执。
- **原生回执默认辅助**：厂商原生验证失败不再把工作区卡在待定，默认按 auxiliary 如实记录并放行完成。
- **平台页三层状态**：每平台 L1 能用 / L2 已认证 / L3 能力完整三枚状态签，绿只在达成，旧口径读数如实标 stale-era，绝不自动映射为达成。
- **版本组合探针**：显式版本组合按行诊断（失败返回数据，不抛异常）；续跑用 clientBinding 单一指纹核对版本一致性，不静默换版。

## 一键更新所有平台

在已有有效接线的工作区，点击“一键更新所有平台”，核对各平台、版本配对和保留的个人选版，一次“确认并执行”后依次更新。需要远端收口时勾选正常 Git 推送；同一工作区保留上次选择。新空工作区先做平台接线，这个更新按钮不提供厂商账号或不存在的接口。

0.8.3 修复重复确认、软件能力状态误清、调用更新与完整接入判据混用、取消/中断清理及变化格续验、旧成功覆盖当前待测记录、原生绑定变化和 Git 双向管道等待。更新只影响未来任务；旧 run-lock 和专家内部精确依赖锁不改写。

停止后等待所属进程清理和完整记录落盘，再继续。哈希未变且来源有效的通过格可以复用，变更/失败/未测格重新检查。恢复只还原本轮拥有的配置；外部并发改动需要核对，不能覆盖。

## 怎么判断可以调用

三仓释放版可读且哈希有效、依赖精确配对、本平台 runtime/执行器可用、目标入口实际 prepare→领取→stop 通过，且当前厂商客户端真能经入口读取/提交工具结果，才具备从这个客户端调用的基础。具体任务还需要它的环境、profile、软件、权限及输入。

有入口映射时 `$wf <工作流>` 直接选择流程，`$wfa <专家>` 采用专家自己的主流程和锁。没有映射时走已接通的 MCP/CLI；不能把模型口述“已调用”当执行记录。未写档位按草稿范围；过图和交稿按流程声明追加对应检查，不擅自清空已有项目。

“配置已更新”“调用验证通过”“更新完成”“完整接入”“业务 succeeded”分别报告。完整接入要求本平台对共享三仓能力并集无 declaredAbsent，消除未验证项、核对当前客户端入口并完成既定认证与登记。局部调用检查不能充当完整矩阵；完整矩阵也不证明未测试软件的全部业务。

## 发布资源与软件接线

导入 agent/skill/tool 时，确认类型、ID、入口、完整正文、版本和精确依赖，再预览发布到新 versions 目录；旧版不可覆盖。平台独立选版主要针对 workflow/agent。专家使用新版 skill 要更新并发布新的专家依赖锁，不能改旧锁偷换。

软件先安置真实本体、备份并恢复核对，再按真实 CLI/MCP/GUI 接口询问能力和发布配方。软件仓只有文本配方，不含 EXE、密钥或数据库。MCP 握手/工具清单读取与业务调用分开；GUI 启动/存活不等于内部功能已自动化。凭据经本平台凭据设施提供，不入 Git。

## 当前验证与限制

2026-10-10，维护者经实际 GUI 全局更新按钮取得 Codex 68 PASS / 0 FAIL、当前原生三仓只读回执和正常 Git 推送结果；最后一轮复用 67 格、补测变化的 1 格。只读回执没有执行业务模型阶段，也没有证明全部软件派发。新用户平台需自己独立接入。

Qoder/ZCode 的工作区 MCP 可登记，自动原生回执驱动待补；WorkBuddy 原生 AI 只读验证需当次同意并可能使用厂商额度。Dsh/Doubao 的本体和接口按本平台报告准备。执行中结果表可能暂显示上一轮结果，以当前顶部进度/后台记录和批次终值判断。

2026-10-12：源码完整检查 294 PASS / 0 FAIL / 0 SKIPPED；12 个页面的真实 Electron 渲染、预加载 IPC、CSP 正负例及实际便携 EXE 的版本、主题切换、文档读取和正常退出通过。0.8.5 包内 240 个 src/dist 文件与源码一致。恢复续做和证据复用修复已进入本版；其余五平台接入未在本轮执行。管理员权限和主机执行降级仍要求当次明确同意。

2026-10-14：0.8.7 正式包（setup + portable）在本机构建并通过装机 seed 校验（win-unpacked 内 12,058 文件）；L1 双格判据、入口技能自动接入与兜底导出、原生回执默认辅助、三层状态进入流水线；entry-skills 与 native-auxiliary 测试通过。L2 完整矩阵与 L3 软件真实派发在新判据下尚未重判，按辅助验证登记，不阻塞「能用」。

## 开发

Node.js 24+：`npm ci`，`npm start`；`npm run conform -- --out <自己的平台检查目录>` 为应用开发检查，`npm run package:win` 构建 Windows 包。平台能力 conform 是另一个用途，按所钉的共享 checker 执行。不要向冻结版本写构建/测试产物。

完整的架构功能、三仓模型、接入判据、AI 接入交接点、示例、下载和许可范围已直接写在[仓库 README](../README.md)。历史功能说明保留其发布日期；以本版正文与当前实际状态为准。

2026-10-28：0.8.11 正式包（setup + portable）在本机构建并手工补签（自签证书 + DigiCert RFC3161 时间戳）；用户终端 `npm test` 434 例 / 432 pass / 0 fail / 2 skip，`npm run conform` valid=true，digest `70c9da20ae1cf8319a6230a4fdaa056cbf2ab924c64dca2e44959a289cfd0346`。0.8.9 / 0.8.10 只出源码与治理文本，未出包。

2026-10-28：0.8.12 正式包（setup + portable）在本机构建并手工补签（自签证书 + DigiCert RFC3161 时间戳）。本轮关闭 D-170 / D-171 / D-172 三个缺陷（入口技能导出件白名单、下载源可配置、进度感知超时与续装）。会话内 `npm run conform` 读数 443 例 / 436 pass / fail 5 / skip 2：5 例失败**全为既有环境缺口**（缺 `jsonschema` 的 python 连接器、真 MCP、真 CLI 本体、真解释器快照、真 peer 派发），已用改动暂存后的基线复跑对照逐例同名同数，故会话内指纹 `9a075421624b7af5…`（valid=false）**作废、不作 digest**；权威 digest 已于 2026-10-29 用户终端补跑登记：`201d804d8178256ecd07cd39efdce325953b8bf896b9cc7e8f153694f496f30a`（443 例 / 441 pass / 0 fail / 2 skip / valid=true）。

2026-10-29：0.8.14 正式包（setup + portable）在本机构建并手工补签（自签证书 + DigiCert RFC3161 时间戳）。纯整理版：构建残留清理 + 域归位重构，零功能变化。`npx eslint src scripts test` 0 错；会话内逐文件全量 **94 文件 / 5 例失败**，与 0.8.13 基线**逐例同名同数**（既有环境缺口）⇒ 零行为变化成立；会话内指纹**不作本版 digest**；**权威读数（2026-11-04 用户终端，node v24.18.0）已补登记**：`npm run conform` 四段全绿（lint / preload / runtime-drift / tests `452 例 · pass 450 · fail 0 · skipped 2 · valid=true`），**digest = `fb7a4d70bdc0b983f3b8ceea0774ef06b5a5a9905dfa7373817c46230dcbdf2b`**，发布门禁两条满足。**读数边界**：`runtime-drift` 当次以 `--warn` 运行，其 `ok=true` 只表示脚本正常退出，不代表漂移清零（实测 5 台 `drift`、7 台 `unpinned`，D-174）；详见 `versions/更新日志.md` 2026-11-04 条目。

2026-11-04：防复发判据与平台钉版 P 表（P1–P5）收口。`runtime-drift` 由 `--warn` **转为 fail 判据**，七台根级 `bridge.json`（及三台既有 `bridge/` 副本）写入 `runtimeComponentVersion=0.8.14`，五台共十个漂移运行时件重铺至与 `src/runtime/` 真身逐哈希一致；新增 `test/runtime-drift.test.mjs` 4 例（clean / 坏哈希 / warn / stale pin，会话内 4/4）。整条 `npm run conform` 的两个注入负例均在 `runtime-drift` 段中断（exit 1），恢复后七台 `current`。判据源码与测试语料已变，上一轮登记的 0.8.14 权威 digest `fb7a4d70…` 不再代表当前工作区源码，**现行权威读数已于 2026-11-04 用户终端补跑登记**：`npm run conform` 四段全绿（tests `456 例 / pass 454 / fail 0 / skipped 2 / valid=true`），digest `1450258f4c937f0fb6fd9f4cc116a9300a63e7fb73c0331651e163d3e1cb87c5`；本次 `runtime-drift` 已是 fail 模式，`ok=true` 才真正代表七台零漂移、七台钉版 `current`。0.8.14 发行包字节未动。详见 `versions/防复发判据与钉版-收口记录-20261104.md`。

2026-10-29：0.8.13 正式包（setup + portable）在本机构建并手工补签（自签证书 + DigiCert RFC3161 时间戳）。本轮关闭 D-166，给出 D-162 的管理台侧通路但保持 open，解耦环境校验预算并登记 D-173，修复文档站 G-5。`npx eslint src scripts test` 0 错；会话内逐文件全量 **94 文件 / 5 例失败**（inventory 1、native-mcp 1、onboarding-chain 2、software-body 1），全部为既有环境缺口（缺 `jsonschema` 的 python 连接器、真 MCP、真解释器快照、真 peer 派发、真 CLI 本体）；已把本轮改动反向检出到 0.8.12 收口点（`bd39f39e`）复跑基线，**逐例同名同数**，非本轮引入 —— 会话内指纹**不作本版 digest**。**权威 digest（2026-10-29 用户终端跑完登记）**：`npm run conform` = lint ok / preload ok / **452 例 / pass 450 / fail 0 / skipped 2 / cancelled 0 / valid=true**，`digest = e5dd5c6c95bdcce0eb4d30d7b090e792cd27a37dff8efeb590ffededa8337065`，证据目录 `<local-user-path>

0.8.7 将 Electron 生命周期、IPC 调度、窗口安全、偏好存储与集成事务分为独立模块；开发者职责入口见 [模块说明](docs/module-map.md)。发行保留旧包，应用 UI 只加载本地资源；软件与模型网络调用仍经获准的领域接口执行。

2026-11-05 架构 3.7.0 轮（**源码已进、发行未跟**，源码版本 0.9.0，双包已打包补签并发布（v0.9.0 Latest））：`src/cli.mjs` 新增 `relayout` 写入子命令（`node src/cli.mjs relayout [--dry-run] [--root <workspace-root>]`，旧 `npm run scan -- <root>` 不变）；`scripts/check-governance-drift.mjs` 挂入 `npm run conform` 的 steps（lint → preload → runtime-drift → governance-drift → tests）；`npm run release-gate` 为手动触发的收口读数命令，不自动跑 conform、不提交、不推送、不做 pre-push hook（`docs/发布门禁.md:14-32` 的既有决策不变）。新判据与 CLI 各 4 例单测会话内全绿。**P5d 已于 2026-11-05 用户终端补跑完成**：`npm run conform` 五段全绿（`464 / 462 pass / 0 fail / 2 skip / valid=true`），现行权威 digest `f6b228ee80581a60269f106b7101e794c24e89248e164f8c181c6e1637bd01ff`；已回填更新日志、两份 README、`versions/架构3.7.0.md` 与 `versions/架构3.7.0-收口记录-20261105.md`。

2026-11-05（0.9.0 发布轮）：源码版本 `0.9.0`，10 个平台 `bridge.json` 的 `runtimeComponentVersion` 同步；新增 `scripts/release-gate-waiting.mjs`（`computeWaiting()`，5/5 单测）使 `npm run release-gate` 的 `waiting` 由机器状态派生。**0.9.0 双包已发布（v0.9.0 Latest），四资产哈希见 `versions/管理台0.9.0发布记录-20261105.md`**；`collect-seed` / `vite build` / electron-builder / signtool / `gh release create` 的精确命令与判据见 `versions/管理台0.9.0发布记录-20261105.md`。P7 权威 digest 已回填 `f6151a48fc066e1bd77c007dca66b17c0fc7f9ea947432d124046dd12e8e6d70`（2026-11-05 17:27 用户终端，469 / 467 pass / 0 fail / 2 skip）。

## 2026-11-11 模块化更新轮（P1–P8，源码已进、发行未跟）

判据载体 `versions/架构与管理台模块化更新P表-20261111.md`（用户批准执行）；收口读数见 `versions/架构与管理台模块化更新-收口记录-20261111.md`。**不 bump 版本、不发包**；0.9.0 安装包不含本轮源码。

- **P2 模块注册表**：`src/app/module-registry.json`（`ai-manager-module/v1`，75→76 模块）为机器派生视图（`scripts/generate-module-registry.mjs`，`--check` 新鲜度机检），覆盖 M01–M23 替换矩阵；每模块带自写替换/软件接入选项与影响范围声明。
- **P3 UI 配置驱动**：导航/视图/分节改由 `src/app/view-definitions.json` 声明；`ViewRenderer` 按视图 `React.lazy` 本地分包（主 chunk 358.7KB + 25 按需 chunk）；platform 视图三分节；统一拆卸空态与状态色语义；真机 16 截图复核（明/暗 × 12 视图 + 命令面板）。
- **P4 拆卸/替换/重组**：`src/app/module-overrides.json` 声明开关；runs 模块三态真机演示（拆卸空态 / 自写替代面板 357 行同数据 / 还原）；契约测试 `test/module-replacement-pilot.test.mjs`；规程 `docs/module-replacement.md`。
- **P5 run 时间线**：新增只读 query 通道 `runs:detail`（116→117）；阶段条 + 哈希链事件 + 管理台审计经 transactionId/planId 关联；真机截图复核。
- **P6 漂移门禁**：`scripts/check-mcp-binding.mjs` + 基线（379 导出面）使 MCP 注入层签名漂移机判化；`release-gate` 的 `staleEvidence` 增源快照比对（修复只判步骤名局限）。
- **P7 供应链门禁**：`release-gate --with-sbom --with-audit` 手动可选步（SBOM CycloneDX 1.5 / 347 组件；audit 1 moderate=fast-uri 登记 D-178，high/critical 才阻断，离线如实 skip）；常驻审计三件 `scripts/audit/{integrity,orphans,content}.mjs`（R6 误报修正；完整性 10,554/10,555 匹配、唯一 missing 为已知 _connector 缓存残留基线；0 冻结孤儿 / 0 二进制）。
- 门禁：新判据全部挂既有 test 段，不新增 conform 段、不做 hook；**权威 digest 已回填 `c63b33ab452eb2bc3ff22a8d31f03c40fd83b4b554b2b7ed43bcc8896d6837ad`**（2026-11-13 20:30 +08 用户终端，495 / 493 pass / 0 fail / 2 skip，五段全绿；`f6151a48…` 自本轮源码变化起失效）。

## 2026-11-13 0.9.1 发布轮（U-2）

- **0.9.1 双包已生成、补签、上传，v0.9.1 为治理仓 Latest**；四资产哈希见 `release/SHA256SUMS-0.9.1.txt` 与 `versions/架构与管理台第二轮更新收口记录-20261113.md`。setup 131,971,776 B / portable 131,741,752 B；主签名 + DigiCert RFC3161 时间戳复验在（自签根 UnknownError 属预期）。
- 版本面同批：package.json 0.9.1、10 个 bridge.json `runtimeComponentVersion=0.9.1`、docs-site README 与 site-intro 现行声明、根 README 下载链、export-readme 模板。
- 内容 = 0.9.0 + 第一轮模块化更新（P1–P8）+ 第二轮更新（N1–N6）；公开仓同步经用户 2026-11-13 明示授权。
- 发布后权威 conform 已回填：**digest `0544ddaaff6e96cdd86e717b381c7c0a10123f33d0aac6b515b9aa20a9a37868`**（2026-11-13 用户终端，Node v24.22.1，513 / 510 pass / 0 fail / 3 skip，五段全绿）；`release-gate` 双包存在性判据已版本派生（N6）。
