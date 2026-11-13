# 两个 MCP 全功能覆盖 3.0.0 — P 表（2026-11-08）

> **状态：用户 13:33 指令「这么多 X，全变成✓，我要尽可能实现功能，只要不涉及红线」＝本轮实施授权。** 判据载体本文件 P1…P7，按 BP-5 照案执行。
> 对象：`architecture-manager-mcp` / `ai-novel-platform-mcp`（现行 2.0.0，各 20 工具）。用户嫌上一张覆盖表里 ✗ 太多，要求除红线外全部补齐。

## 1. 事实基线（自动枚举，非手写）

| 项 | 读数 |
|---|---|
| 管理台 | 104 个域模块 / **363 个函数导出**（Node 22 下 104/104 可 import） |
| 小说平台 | 41 个服务模块 / **439 个函数导出**（41/41 可 require）；软件自身 **123 个 IPC 通道** |
| 2.0.0 缺口 | 白名单手写导致 `story-state.cjs`、`creative-workspace.cjs` 实际加载到 0 个函数；`getWorldMap`、`novel-network`、`snapshots`、`tasks` 等大块功能未登记 |
| 真实调用验证 | `novel_call → analysis-tools.cjs#buildRelationshipGraph` 返回 `{nodes,edges,options}` ✅；`experiments.cjs#getWorldMap` → `FUNCTION_NOT_WHITELISTED` ✗ |
| 版本 | 1.0.0 / 2.0.0 已发布只读 ⇒ 发 **3.0.0** 新目录，`available` 列三个版本 |

## 2. 哪些 ✗ 变 ✓，哪些必须留 ✗（红线清单）

**变 ✓（用户授权）**：一键接入 apply、全局更新、计划中心、文档写入、本体导入、认证/矩阵、克隆、审计写、软件中心操作、conform 与 release-gate 的实际执行（本地）、项目设置、全局搜索、导出 docx、章节 CRUD/进度/版本/恢复、故事事实/伏笔/章节板、创意工作区、小说统筹网、任务中心、快照/分支、修订、恢复草稿、素材/人物/世界保存、世界地图、关系图数据、删除类动作（**带确认 + 前置备份**）。

**必须留 ✗（红线，用户明确「不涉及红线」）**：

| 类别 | 判定 |
|---|---|
| 云模型调用 / 外发项目上下文 | `ai-generate.cjs`、`chat-stream.cjs`、`callChatApi`、`askAI`、`callStructuredChatWithProgress`、`generate*FromOutline`、`buildCreativeAdvice` 等；凭据不上送、不外发、不转发 |
| 凭据读写 | `credentials.cjs`、`windows-credentials.cjs`、`*Credential*`、`*Secret*`、`*Password*` |
| git push / 发包上传 / 签名发布 / 远程更新 | `*push*`、`*publish*`、`*upload*`、`*deploy*`、`downloadUpdate`、`package:win` 上传、`applyRelease` |
| 改共享 `current` / 抬引擎默认 | 红线 5；`switchDefaults` 类函数排除 |
| GUI 渲染 | 不是红线但属技术边界：MCP 只交付**可渲染数据**（nodes/edges、图表 JSON），界面渲染由软件或宿主完成 |
| 跨进程并发写 | 运行时约束：桌面应用打开同一项目时禁用写工具 |

> 删除类动作按用户「全变✓」纳入，但一律经 `*.plan` 确认且调用服务层自带的快照/事务；这不等于删除红线被取消，而是把不可恢复风险交给确认协议与既有备份机制。

## 3. 架构决策

| 决策 | 内容 |
|---|---|
| AD-1 | 发 **3.0.0**，`available=["1.0.0","2.0.0","3.0.0"]`；1.0.0/2.0.0 字节零改动 |
| AD-2 | **白名单由盘上真实导出自动生成**（`workbuddy/runtime/tmp/feas/v3/*-exports.json`），不再手写猜函数名 |
| AD-3 | 函数分三类：**只读**（读动词前缀 + 纯函数）→ `*_call` 直接调；**写**（保存/创建/更新/删除/导入/重建/恢复/任务/快照/分支等）→ 新增通用确认写工具 `arch_apply` / `novel_apply`；**红线** → 显式黑名单，两个通道都拒绝 |
| AD-4 | 红线用**精确模块 + 精确函数名黑名单**，不用宽泛正则误伤（`buildReleasePlan` 曾被误判红线） |
| AD-5 | `*_apply` 必须 `planId` + `confirmToken`（5 分钟、一次性、哈希复算），审计落 stderr；删除类额外要求 `ack: "DELETE"` 参数 |
| AD-6 | 小说平台服务函数自动把 `NOVEL_PROJECT_ROOT` 作为首参注入；管理台域函数参数由调用方显式给 |
| AD-7 | 保留 2.0.0 的 core 只读、注入具名、脱敏、stdout 预加载隔离；`*_capabilities` 改为返回三张清单与计数 |
| AD-8 | `getWorldMap` / 统筹网 / 快照 / 任务中心等通过自动白名单进入 `*_call` / `*_apply`，不再逐个手写具名工具 |
| AD-9 | 共享仓零真实绝对路径、零仓外源码字节；`CAPABILITY_UNAVAILABLE` 结构化降级保持 |

## 4. 工具面（各 21 个）

2.0.0 的 20 个全部保留 + 新增通用确认写工具：
- 管理台：`arch_apply`（写白名单内任意函数，带 plan/confirm，删除需 ack）
- 小说平台：`novel_apply`（同上）

`*_capabilities` 返回 `{readonly: {module: [fn…]}, writable: {…}, redline: {…}, counts, preloadErrors}`，让调用方自己能发现全部可控制的功能。

## 5. 有序 P 表

**P1 盘点与回滚点（~1h，2 子块）**：§1 自动枚举结果落盘；本 P 表单独提交成可回滚 commit。判据：读数可回读、commit 存在；停手点：零写入 `software/`。

**P2 分类与黑名单（~2h，3 子块）**：由真实导出生成三张清单；逐条复核红线黑名单（精确名），确认 `buildReleasePlan`、`estimateTokenCount` 等非红线项不被误伤。判据：三张清单总数 == 导出总数、红线项抽样复查；停手点：每子块一停。

**P3 实现 3.0.0（~3h，4 子块）**：基于 2.0.0 生成 3.0.0 全套文件，注入自动白名单、新增 `*_apply`、更新 `*_capabilities`；影子目录先跑校验。判据：语法、schema 6/6、lint 0/0、红线扫描 0；停手点：每子块一停。

**P4 可行性循环（~2h，4 子块）**：① 握手 + tools/list=21；② `*_call`/`*_apply` 各抽样覆盖上一轮表格里的主要 ✗ 功能（关系图、世界地图、统筹网、快照、任务、章节版本、备份、接入计划/校验）；③ 红线负例（云模型、push、凭据、改 current）全部被拒；④ 确认/重放/删除 ack 负例；⑤ 脱敏与 stdout 隔离。判据：抽样全绿、负例全被拒；**发现不可行即回 P2/P3 修正并复跑**。停手点：每子块一停。

**P5 切版本与增量判据（~1h，3 子块）**：`current.json` → 3.0.0、`available` 三版；真实 lint；双单格 `conform --only`；两个漂移判据。判据：指针与目录枚举一致、`unknownOnlyIds=[]`、v3 相关 lint 错误 0；停手点：切指针后即停。

**P6 补账入库（~1h，2 子块）**：`更新日志.md`、P 表执行读数、收口记录；精确提交；四项读数。判据：读数齐备、不谎报。

**P7 完成判定**：P1–P6 按预先判据跑完即完成；红线项仍为 ✗ 属合规，不是未完成。

## 6. 风险登记

1. 自动白名单覆盖面大（363+439 函数），部分函数参数复杂或依赖 Electron 全局 `state`；调用失败时如实返回 `TOOL_FAILED` + 原因，不谎报可用。
2. 写函数很多，`*_apply` 是通用通道 ⇒ 确认协议与审计是唯一防线，不得放宽；删除类额外 ack。
3. 红线黑名单用精确名，若软件新增外发函数而黑名单未更新，存在绕过风险 ⇒ `*_capabilities` 显式列出红线清单便于复核，升级软件后须重跑 P4。
4. 注入层绑定当前源码签名；升级后重跑 P4 探针。
5. 本轮不改 `architecture-manager/` 源码、不改小说平台源码、不改 1.0.0/2.0.0 字节、不发包、不推送。

## 7. 执行读数（2026-11-08）

| P | 判据 | 实盘 |
|---|---|---|
| P1 | 盘点 + 回滚点 | 自动枚举 363 / 439 个真实函数导出落盘；`8cdb0b9d` 早于任何 `software/` 写入 ✅ |
| P2 | 分类与黑名单 | 管理台 290 只读 / 60 写 / 13 红线；小说 292 只读 / 119 写 / 28 红线；三类和 == 导出总数。精确黑名单未误伤 `buildReleasePlan` 等 ✅ |
| P3 | 实现 3.0.0 | 各 21 工具 / 21 文件 / 封条 20 条；`jsonschema` 6/6 0 error、影子 `software_lint` 0/0、红线 0 命中 ✅。**修正一次**：首轮 `novel_apply` 未进 NOVEL_TOOLS（20 能力），修列表后 21/21 |
| P4 | 可行性循环 | R3 首轮 45/46（`readAnchorState` 签名吃 `{workspaceRoot}` 对象，探针传字符串致 ENOENT）→ 修参数后 **46/46 全绿**：三张清单、原 ✗ 模块覆盖、关系图/知识/故事概览真调用、红线双向拒绝、确认/删除 ack/重放、脱敏、stdout 隔离、真实写执行 ✅ |
| P5 | 切版本与增量判据 | `current.json` → 3.0.0 / `available` 三版；真实 lint 4 errors 全为既有、v3 相关 0；双单格 `unknownOnlyIds=[]` / `remediationMissing=[]` / `unionSha256=9682fe4803bb…`；两个漂移判据全绿；真实落点复跑 R3 **46/46** ✅ |
| P6 | 补账入库 | `更新日志.md`、本读数、`versions/两个MCP-全功能覆盖3.0.0-收口记录-20261108.md`；精确提交 ✅ |

**边界复核**：1.0.0 / 2.0.0 字节零改动；`architecture-manager/{src,scripts,test}` 与 `E:\小说\创作平台` 零写入；`f6151a48…` 未失效；`__pycache__` 0。

**仍为 ✗ 的项（红线，合规）**：云模型/外发、凭据读写、git push / 发包上传 / 签名 / 远程更新、改共享 `current`；技术边界：GUI 界面渲染（只交付可渲染数据）、桌面应用打开同一项目时的并发写。这些不是未完成，是用户「只要不涉及红线」的授权边界。
