# 两个 MCP 全功能覆盖 3.0.0 — 收口记录（2026-11-08）

> 判据载体 `versions/两个MCP-全功能覆盖3.0.0-P表-20261108.md`（用户 13:33 指令＝授权）；逐 P 读数见 P 表 §7，探针在 `workbuddy/runtime/tmp/feas/`（平台私有 tmp）。
> 性质：共享软件配方新版本发布 + 平台配置面维护。`agent/workflow = null`，未执行业务 run、未抬共享 `current`、未改两个软件源码、未改 1.0.0/2.0.0 字节、未发包。

## 1. 结论

按「红线外全变 ✓」的要求，把两个 MCP 的白名单从**手写**改成**由盘上真实导出自动生成**：管理台 363 个函数（290 只读 / 60 写 / 13 红线）、小说平台 439 个函数（292 只读 / 119 写 / 28 红线）。新增通用确认写工具 `arch_apply` / `novel_apply`，各 21 个工具，发 `3.0.0` 并切换指针。上一张覆盖表里除红线外的 ✗ 全部转为可通过 `*_call`（只读）或 `*_apply`（确认写）触达。

## 2. 用户两个例子现在的结果

| 例子 | 之前 | 现在 |
|---|---|---|
| 跑一键接入 | ✗（只能出计划/校验） | ✅ `arch_apply` → `onboarding/onboarding-auto.mjs#applyAutomaticOnboarding`（写白名单内，需 plan/confirm） |
| 画思维导图 | ✗（关系图数据也拿不到世界地图） | ✅ `novel_call` → `analysis-tools.cjs#buildRelationshipGraph` 返回 `{nodes,edges,options}`；世界地图 / 统筹网等图形数据函数也已进白名单。**界面渲染仍属 GUI 边界**，MCP 交付数据 |

## 3. 覆盖与红线

**变 ✓**：一键接入 apply、全局更新、计划中心、文档写入、本体导入、认证矩阵、克隆、审计写、软件中心操作、conform / release-gate 本地执行、项目设置、全局搜索、导出 docx、章节 CRUD/进度/版本/恢复、故事事实/伏笔/章节板、创意工作区、小说统筹网、任务中心、快照/分支、修订、恢复草稿、素材/人物/世界保存、世界地图、关系图数据。删除类动作按用户要求纳入，但需 `planId`/`confirmToken` + `ack:"DELETE"`。

**仍 ✗（红线，合规）**：云模型调用与项目上下文外发；凭据读写（`credentials.cjs` 等整模块）；git push / 发包上传 / 签名发布 / 远程更新；改共享 `current`。**技术边界**：GUI 界面渲染（只给可渲染数据）、桌面应用打开同一项目时的跨进程并发写。

红线判定用**精确模块 + 精确函数名黑名单**，避免 `buildReleasePlan`、`estimateTokenCount`、`hashToken` 被宽泛正则误伤；`*_capabilities` 显式列出 redline 清单供复核。

## 4. 判据读数

| 判据 | 读数 |
|---|---|
| R1 影子 | 语法 10 个 `.mjs` 全过；schema 6/6 0 error；`software_lint` 0/0；红线扫描 0 命中 |
| R3 循环 | 首轮 45/46 → 修 `readAnchorState({workspaceRoot})` 探针参数 → **46/46**（三张清单、原 ✗ 模块覆盖、关系图/知识/故事概览真调用、红线双向拒绝、确认/删除 ack/重放、脱敏、stdout 隔离、真实写执行） |
| 真实落点 | 两资源 `mcp-stdio / 3.0.0 / 21 capabilities / windows`，各 21 文件封条 20/20；R3 探针按 id 匹配复跑 **46/46** |
| 真实 lint | 4 errors 全为既有基线（nmap ×3、`_connector` ×1），**v3 相关 0** |
| 双单格 | `unknownOnlyIds=[]` / `remediationMissing=[]` / `unionSha256=9682fe4803bb27846edcd80ed8bfb4266d31e8113d444d8e384b964fa27f7919` |
| 漂移 | `governance-drift ok=true`；`runtime-drift ok=true / drifted=[]` |
| 红线 | 1.0.0 / 2.0.0 零改动；两个软件源码零写入；发布目录 `__pycache__` 0；权威 digest `f6151a48…` 未失效 |

## 5. 四项入库读数（BP-6）

| # | 读数 | 实盘 |
|---|---|---|
| 1 | HEAD sha | 回滚点 **`8cdb0b9d`**（P 表单独提交，早于任何 `software/` 写入）；本轮实现与治理文本为随后提交，sha 由 `git log -1` 回读。 |
| 2 | 白名单内 `git status` 空 | 本轮路径全部入库后为空 ✅；全仓仍有 2 项既有且未动：`M qoder/bridge/client-adapter.json`、`?? software/PacketTracer 8.0/`。 |
| 3 | 远端与本地一致 | ❌ **不满足**：`origin/main` 仍 `a4df1393`，本地持续领先；代理此前实测 10 个端口全 `000`，本轮未重复试探、未推送。按 BP-6 不称完整收口。 |
| 4 | 入库早于破坏动作 | ✅ `8cdb0b9d` 早于新建 `versions/3.0.0/` 与切换 `current.json`。 |

**用户终端待执行**：开梯子后 `git -C E:/ai -c http.proxy=$HTTPS_PROXY push origin main`，回读 `ahead 0` 后补登记。

## 6. 使用与维护

- 注入根：`ARCH_MANAGER_ROOT` / `NOVEL_APP_ROOT`；项目根：`ARCH_WORKSPACE_ROOT` / `NOVEL_PROJECT_ROOT`。缺注入时 core 只读可用，注入工具返回 `CAPABILITY_UNAVAILABLE`。
- 查全部可控制功能：调 `arch_capabilities` / `novel_capabilities`，返回 readonly / writable / redline 三张清单与计数。
- 只读：`*_call {module, fn, args}`；写：`*.plan {tool, arguments}` → `*_apply {module, fn, args, planId, confirmToken}`（删除类加 `ack:"DELETE"`）。小说平台服务函数自动注入项目根作首参。
- 自动白名单绑定两个软件**当前**函数签名；任一升级后重跑 `workbuddy/runtime/tmp/feas/r3_probe.mjs`（46 项）。若软件新增外发/凭据函数，须同步更新红线黑名单并重跑 P4。
- 维护期：平台侧 `nativeMcpServers` 注册、`versions/README.md` / `CATALOG.md` 书目补登、git 推送，以及 §3 列出的红线外能力（需另立 P 表与单独授权）。

## 7. 完成判定

P1–P6 按预先判据跑完，可行性循环收敛并在真实落点复现；判为「实现完成、远端一致待推送补齐」，不谎报为完整收口。红线项仍为 ✗ 属用户授权边界，不是未完成。
