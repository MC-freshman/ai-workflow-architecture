# ai-novel-platform-mcp — 方案与 P 表（2026-11-07）

> **状态：v1.0，待可行性验证。** 用户 2026-11-07 指令「另外再创建一个 mcp，出 P 表，放在 `E:\ai\software\ai-novel-platform-mcp`，针对的是 `E:\小说\创作平台` 中的那个软件」；并指令「已有 P 表和新 mcp P 表出完后，进行可行性验证，如果找到不可行处就修改，然后再验证，如此循环直到确认可行性没问题就开始实施」。本文件是判据载体，**验证未全绿前不实施**。
> 落点：`E:/ai/software/ai-novel-platform-mcp/`（用户 12:02 预建的空目录，0 文件，未入 git）。

> **v1.2 修正（R1 可行性探针后，覆盖 v1.0 冲突条款；读数见 `versions/两个MCP-可行性验证记录-20261107.md`）**：
> 1. manifest 的 capability **10 必填字段**、concurrency **4 必填字段**、recipe 的 `verify` **3 必填字段**（`versionCall`/`selftestRef`/`files`）全部按 `repo-lint 0.7.0` schema 填齐；P3 增加「先跑 `jsonschema` 三件套、再跑 `software_lint`」判据。
> 2. `install.location` 用 `${platformRuntime}/software/ai-novel-platform-mcp`，**共享仓零真实绝对路径**；项目根只从 `NOVEL_PROJECT_ROOT` 取，README 示例也用占位符。
> 3. 声明 `runtime: node>=20`（R1 已在 `v22.22.2` 实测 stdio 握手通过），不 import 目标软件源码；AD-6 的可选服务层复用**本代不启用**，全部工具走纯文件层（消除对 `E:\小说\创作平台` 源码的耦合）。
> 4. `novel.project.info` **只回白名单字段 + 顶层键名**，不回显 `novel.config.json` 中可能的模型服务配置；JSON 内禁 `token/password/secret` 字面值（`_check_credentials`）。
> 5. `capabilities.snapshot.json` 带 `frozen:true` 且与 manifest 逐条对齐；`SHA256SUMS` 覆盖 release 全部文件；`SOURCE.json` 必带；`selftest` 的 capability 必须在 manifest 声明。
> 6. 合成项目（`.test-runs/*/project`）**只用于探针，路径不写入配方**；配方 selftest 通过环境变量注入项目根，缺失即结构化拒绝（AD-4 保持）。

## 0. 目标软件与语义裁定（只读实盘，2026-11-07）

| 项 | 读数 | 出处 |
|---|---|---|
| 软件 | AI 小说创作平台 `ai-novel-writing-platform` **0.3.9**，Electron + Vite + React/TS，Windows x64 | `E:/小说/创作平台/package.json` |
| 定位 | 长篇小说本地桌面软件：正文/大纲/人物/世界观/进度 + 本地知识库 RAG | `README.md:3-5` |
| 运行要求 | `engines.node >=22.12.0`；本机会话内 Node **v22.22.2** | `package.json` / `node -v` |
| 对外接口 | **无 HTTP server、无 MCP、无外部 API**。只有 Electron `ipcMain.handle`（渲染 ↔ 主进程，经 preload），外部进程无法调用 | `electron/ipc/register.cjs:12`、`shared/contracts/ipc-channels.cjs`；全树 grep `createServer/.listen(`/`mcp` 无命中 |
| 能力面 | 90+ IPC 通道（project / chapter / analysis / knowledge / story / workspace / novel-network 等） | `shared/contracts/ipc-channels.cjs` |
| 服务层 | `electron/services/*.cjs` 为 CommonJS 模块，**已实测可 headless require**：`project-files.cjs` 导出 `getConfigPath` / `getChapterPath` / `loadCharacters` / `loadWorldDocs` / `loadChapterContent` 等；`ipc-channels.cjs` 导出 `channels` | `node -e require(...)` 实跑 OK |
| 项目数据 | 独立于安装目录的文件树：`novel.config.json`、`chapters/*.md`、`characters/`、`world/`、`materials/`、`vector_db/`、`analysis/snapshot.json`；本机存在合成测试项目 `.test-runs/*/project/novel.config.json` | `project-files.cjs:213-260`、`README.md:40-43`、实盘 find |
| 默认项目目录 | `<local-user-path> **当前不存在** ⇒ 路径不能硬编码，必须运行时注入 | 实盘 ls |

**语义裁定（重要）**：「针对那个软件」= 针对它的**项目文件层 + 可 headless 复用的服务层**，让 AI 通过 MCP 读（并在受控确认下写）小说项目数据；**不是**驱动 GUI exe、不是调用 Electron IPC、不启动应用窗口。理由：应用没有对外服务，外部进程唯一稳定的交互面就是它自己定义的项目目录格式与 CommonJS 服务层。若用户本意是 GUI 自动化，需另立 P 表（超出本轮）。

## 1. 目标 / 非目标 / 决策

**目标**：在 `software/ai-novel-platform-mcp/` 建一个 `mcp-stdio` 软件配方（三仓同构），提供只读优先的小说项目工具面，写操作默认关闭且需逐调用确认；不改动目标软件任何字节。

**非目标**：不改 `E:\小说\创作平台` 任何文件 · 不启动/注入 Electron 应用 · 不复制其源码或二进制进共享仓（BP-1）· 不新增一级目录 · 不抬共享 `current` · 不发包 · 不做跨平台（先 windows）· 不做 0.2.0。

| 决策 | 内容 | 理由 |
|---|---|---|
| AD-1 | 配方按三仓同构：`current.json` + `versions/1.0.0/` + `SHA256SUMS` + `manifest.json` + `capabilities.snapshot.json` + `recipes/windows.json` + `selftest/readonly.json` + `SOURCE.json` + `schemas/*.json` + `src/server.mjs` | BP-1 / 3.0 同构；`software_lint.py:304` 要求 `目录名 == registry.id == manifest.id` ⇒ id 固定 `ai-novel-platform-mcp` |
| AD-2 | 零依赖 Node stdio JSON-RPC server，协议版本取 `2025-06-18`（与 `mcp-config.mjs` 支持集一致） | 与 VMware 配方同构，避免 npm 依赖进入冻结面 |
| AD-3 | 路径全部经环境变量注入：`NOVEL_PROJECT_ROOT`（必填）、`NOVEL_APP_ROOT`（可选，复用服务层）；**共享仓内零真实绝对路径** | BP-1「仓内只放可冻结文本」、BP-2「禁平台专有常量」；`recipe.install.location` schema 强制 `${...}` 或占位形式 |
| AD-4 | 缺失 `NOVEL_PROJECT_ROOT` 或目录无 `novel.config.json` ⇒ 结构化拒绝 `NOVEL_PROJECT_ROOT_REQUIRED` / `NOVEL_PROJECT_INVALID`，绝不猜测默认路径 | 默认项目目录实测不存在；不谎报可用 |
| AD-5 | 只读工具默认开放；写工具默认关闭、`confirmToken` + plan 复算，`MANAGER_PLAN_DRIFT` 拒绝 | 沿用管理台 MCP 方案 AD-3；正文是用户核心资产 |
| AD-6 | 目标软件的服务层**只在 `NOVEL_APP_ROOT` 显式提供且 `require` 成功时**才复用，否则退化为纯文件层解析（仍可用） | 服务层可能依赖 electron 运行时；headless 已验证 `project-files.cjs` 可 require，但不把可用性建立在它之上 |
| AD-7 | 本轮只做共享侧配方与单格冒烟；平台侧 `nativeMcpServers` 注册由各平台自证（BP-2） | D-60：登记 ≠ 可派发 |

## 2. 工具面（v1.0，P2 定稿时以 schema 为准）

| tool | 数据来源 | 副作用 |
|---|---|---|
| `novel.project.info` | `novel.config.json` | none |
| `novel.chapter.list` | `chapters/` + config 的文档树 | none |
| `novel.chapter.read` | `getChapterPath()` / `loadChapterContent()` | none |
| `novel.character.list` | `loadCharacters()` | none |
| `novel.world.list` | `loadWorldDocs()` | none |
| `novel.knowledge.status` | `vector_db/summaries.json` | none |
| `novel.analysis.state` | `analysis/snapshot.json` | none |

写工具（默认关闭）：`novel.chapter.write`（保存正文，需 confirmToken + 备份 + 修订校验）、`novel.project.settings`（改配置）。错误信封含 `NOVEL_PROJECT_ROOT_REQUIRED` / `NOVEL_PROJECT_INVALID` / `NOVEL_TOOL_UNKNOWN` / `NOVEL_CONFIRM_REQUIRED` / `NOVEL_PLAN_DRIFT` / `NOVEL_PATH_ESCAPE`。

## 3. 有序 P 表

**P1 只读盘点与回滚点（~1h，2 子块）**：核对 §0 全表；确认两个目标目录为空、`git status` 起点；新增文档先入库形成可回滚 commit。**判据**：读数落盘、commit 存在；停手点：零写入 `software/`。

**P2 契约定稿（~2h，3 子块）**：定 7 个只读 tool 的 input/output schema、capabilities 声明、错误码、确认协议；`schemas/*.json` 逐个落盘。**判据**：schema 可被 `jsonschema` 校验、工具数与 manifest 一致；停手点：每子块一停。

**P3 配方实现（~2h，4 子块）**：`src/server.mjs` + `src/lib/{project,chapters,errors}.mjs`；`manifest.json` / `capabilities.snapshot.json` / `recipes/windows.json` / `selftest/readonly.json` / `SOURCE.json` / `README.md` / `current.json`；逐文件 `SHA256SUMS`。**判据**：`software_lint` 对本资源 findings 0、封条全绿、`mcp-stdio` 握手成功；停手点：每子块一停。

**P4 可行性判据（~1h，3 子块）**：① `initialize → tools/list → tools/call` 真回环（含 `NOVEL_PROJECT_ROOT` 缺失负例）；② 用合成项目跑 `novel.project.info` / `novel.chapter.list` / `novel.chapter.read` 三个只读用例；③ 路径越界负例（`../`）被拒。**判据**：三类全绿、负例全被拒；停手点：每子块一停。

**P5 共享侧登记与增量冒烟（~1h，2 子块）**：`software/registry.json` 追加第 8/9 条（与另一份 P 表同批）、`alignedNow` 同步、`software/README.md` 计数；`platform-conformance --only ai-novel-platform-mcp` 单格；本平台 `gapPlan` 补登记。**判据**：registry 条目合法、单格 `unknownOnlyIds=[]` 且带 gapPlan、`check-governance-drift` / `check-runtime-drift` 仍绿；停手点：登记后即停。

**P6 补账与入库收口（~1h，2 子块）**：`versions/更新日志.md`、收口记录、P 表执行读数；精确 `git add` 提交；四项读数（HEAD / 白名单 status / 远端一致 / 入库早于写入）。**判据**：四项按实盘给出、不谎报；停手点：入库前后各一停。

## 4. 完成判定与风险

P1–P6 按预先判据跑完即完成；等待型项（平台侧注册、git 推送、0.2.0 写工具启用）归维护期。风险：① 合成项目格式与真实项目可能有差异，故 AD-4 结构化拒绝而非猜测；② 服务层未来若引入 electron 依赖，AD-6 保证退化路径仍可用；③ 正文写入涉及用户核心资产，默认关闭且不进 selftest；④ `recipe.install.location` schema 强制 `${...}` 占位，不得写 `E:\小说\...`；⑤ 共享仓配方不得引用 `.test-runs/` 运行产物路径。
