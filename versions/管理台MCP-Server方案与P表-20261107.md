# 架构管理台 MCP Server — 方案与完整 P 表（2026-11-07）

> **状态：方案，未获批准，零实施授权（BP-5.1）。** 用户 2026-11-07 指令「② 新开方案；③ 只出一份完整 P 表供你审阅、暂不实施」。本文件只做议题的执行化表述；**P1 之前不修改任何既有文件、不写任何代码、不改任何配置**。用户明确「整体批准」后才照案执行。
> **代际命名**：不新增架构代、不 bump 管理台版本、不发包、不新增一级目录、不改三仓骨架与共享 `current`、不改 BP 条款。属 `architecture-manager` 产品平面的**新入口**。
> **本文件同时是 ③ 要求的那份完整 P 表**（§6）。

> **v1.1 修订（2026-11-07，用户裁定落点）**：用户指令「管理台MCP-Server要放在 `E:\ai\software\architecture-manager-mcp`」。**本段覆盖 v1.0 中与之冲突的条款**（§3 非目标、§5 变更清单、§6 P3/P5、§7 风险），冲突时以本段为准：
> 1. 落点由 `architecture-manager/src/domains/manager-mcp/` 改为 **`software/architecture-manager-mcp/`**；形态由「产品内部新入口」改为**共享软件配方**（`mcp-stdio`，三仓同构：`current.json` + `versions/1.0.0/` + `SHA256SUMS` + manifest / capabilities.snapshot / recipe / selftest / schemas / SOURCE / README）。id = 目录名 = `architecture-manager-mcp`（`software_lint.py:304/:95` 硬判据）。
> 2. 因此**不改 `architecture-manager/` 任何源码**（不碰 `cli.mjs` / `conform.mjs` / `package.json` / `src/`），管理台权威 digest `f6151a48…` 不受影响。原 U4「CLI 与 MCP 共用 domain 函数」改为 **AD-1′：自包含只读 server + 可选 CLI `--dry-run` 子进程**，避免共享件绑定到 `E:/ai/architecture-manager/...` 绝对路径，也避开 `engines.node>=24` 与本机 `v22.22.2` 的落差。
> 3. 工具面收缩为**只读治理文件**：`arch.software.list`（registry）、`arch.software.read`（current/manifest）、`arch.versions.current`（anchor.json）、`arch.defects.list`（缺陷簿）、`arch.conform.status`（证据）、`arch.governance.status`（三处基线指针）、`arch.relayout.dryrun`（调 CLI `--dry-run`，零写入）。写工具（apply / onboarding / git / 发布）**本代不做**，不成为绕过 plan→checkpoint→audit 的通道。
> 4. 路径经环境变量注入：`ARCH_WORKSPACE_ROOT`（必填）、`ARCH_MANAGER_ROOT`（可选）；缺失则结构化拒绝 `ARCH_WORKSPACE_ROOT_REQUIRED`。共享仓内零真实绝对路径（BP-1 / BP-2）。
> 5. registry 条目按 `typeNote` 固定 `invocable:false / transports:[]` ⇒ 该配方**不进 `/wf`+`/wfa` 分母**；MCP 客户端直连属平台侧配置，不属共享侧判据（AD-8′；系统提示词 §9「MCP 由平台 bridge 负责适配」）。
> 6. P3 实现物改为配方文件集；P5 改为「registry 登记 + `--only` 单格冒烟 + 本平台 `gapPlan` 登记」，不再改 `docs/发布门禁.md` 的步骤构成，也不再需要用户终端重跑全量 conform（sources 未变）。
> 7. 新增风险：Node 版本、配方 schema 硬约束（`recipe.install.location` 强制 `${...}` 占位）、目录名 == id、共享件自包含、平台侧注册另案（D-60）。
> **v1.1 仍须通过可行性验证循环（读数见 `versions/两个MCP-可行性验证记录-20261107.md`）；验证未全绿前零实施。**

> **v1.2 修正（R1 可行性探针后，覆盖 v1.1 冲突条款）**：实盘 15 个不可行点见验证记录 R1，修法：
> 1. 配方 manifest 的 capability **10 个必填字段**（`name/nativeName/inputSchemaRef/outputSchemaRef/sideEffects/permissionRequests/consent/idempotent/safeForSelftest/invocation`）、concurrency **4 个必填字段**（`instanceMode/poolSize/exclusiveResources/whenBusy`）、recipe 的 `verify` **3 个必填字段**（`versionCall/selftestRef/files`）全部填齐；P3 增加「先跑 `jsonschema` 三件套、再跑 `software_lint`」判据。
> 2. `install.location` 改 `${platformRuntime}/software/architecture-manager-mcp`；**共享仓内零真实绝对路径**，根路径只从 `ARCH_WORKSPACE_ROOT` 环境变量取。
> 3. 声明 `runtime: node>=20`（R1 在 `v22.22.2` 已实测 stdio 握手通过），不 import 管理台源码，不受其 `>=24` 约束。
> 4. 第 7 个 tool 由 `arch.relayout.dryrun`（需 spawn 子进程，会话内有 EBUSY 既有风险）改为纯只读 **`arch.platform_pins`**（读七台 `bridge.json` 的 `runtimeComponentVersion`）；本代**零写工具、零子进程**。
> 5. `capabilities.snapshot.json` 带 `frozen:true` 且与 manifest 逐 capability 对齐；`SHA256SUMS` 覆盖 release 全部文件；`SOURCE.json` 必带；JSON 内禁 `token/password/secret` 字面值（`_check_credentials`）。

## 0. 摘要：做什么 / 为什么 / 有什么好处

| # | 更新 | 做法（一句话） | 直接好处 | 可度量判据 |
|---|---|---|---|---|
| U1 | 语义裁定 | 「配一个 MCP」= 让管理台**自己作为 MCP Server**，而非纳管/注册外部 MCP | 消除歧义，不重复造已有的 A/B 能力 | §1 三种语义逐条对应实盘 |
| U2 | 只读工具面 | 暴露 `scan` / `readAdoption` / `threeLayer` / `conformStatus` / `governanceDrift` 等只读能力 | AI 客户端不用再靠人转述 JSON，接入维护从「零 AI 会话」升级为「AI 可直接读」 | 每条 tool 与 CLI/域函数同源，一致性单测全绿 |
| U3 | 写工具面（默认关闭） | `relayout` / `onboardingPlan` / `releaseGate` 走 plan→确认→执行，逐调用确认 | 把有界写能力纳入可审计通道，而不是放任手工 | 无 confirmToken / plan 漂移 / 跨平台路径 三类负例全被拒 |
| U4 | 单一实现源 | MCP tool 与 CLI 命令**调用同一 domain 函数**，不复制逻辑 | 满足 `invocation-adapters-spec.md` §223「CLI 与 MCP 并存须同一协议、同一状态机」 | 注入错值 ⇒ 两条通道同时给出同一结论 |
| U5 | 门禁收敛 | 新增判据并进**同一条** `conform`，不另起全矩阵 | BP-3 最小量 | `npm run conform` 五段→六段，负例 exit 1 |
| U6 | 台账与文档 | README / `发布门禁.md` / `module-map.md` / docs-site 源文同步 | 不出现「代码有、台账无」 | `docs-conform` 双档 `PASS 11/0/0`、四项读数齐备 |

**收益**：管理台从「GUI + CLI」双入口变「GUI + CLI + MCP」三入口，三者共用一套域逻辑与判据；AI 会话能直接读架构现状、按 plan 申请有界写入，且每一步都可回读、可拒绝、可审计。**不扩大能力面**（不新增任何原本做不到的动作），只换调用通道。

## 1. 三种语义与现状裁定（2026-11-07 实盘）

| 语义 | 现状 | 证据（路径） |
|---|---|---|
| **A 纳管 / 注册外部 MCP** | ✅ 已有完整链路 | `architecture-manager/src/domains/software/mcp-config.mjs`（stdio / sse / streamable-http，4 个协议版本，拒 `RAW_SECRET` 只收 `reference:`，拒 `PLATFORM_CONFIGURATION_PATH_MISMATCH`）→ `mcp-discovery.mjs`（真 `initialize` + 分页 `tools/list`）→ `domains/intake/mcp-body.mjs`（生成 `ai-software/v1` 冻结配方、逐工具权限审阅、`consent` 按副作用分级、写 `nativeMcpServers` / `softwareProfiles`） |
| **B 作为 MCP Client 有界调用** | ✅ 已有 | `src/runtime/native_mcp.py`（`NativeMcpClient`，禁重定向 `EGRESS_DENIED`、8 MiB 上限）、`src/runtime/mcp_service.py`（`architecture-client-receipt/v1` 平台回执）、`test/support/native-mcp-server.py` |
| **C 管理台自己作为 MCP Server** | ❌ **缺** | `src/cli.mjs` 仅 `scan` / `relayout` 两个命令；`scripts/release-gate.mjs` 仅命令行；全仓无 stdio JSON-RPC server 把管理台能力暴露给 AI 客户端 |

**裁定**：本方案只做 **C**。A 的收口另由 `versions/VMware-MCP配方正式登记-P表-20261107.md` 承担（本轮已获批准并执行）；B 不动。

## 2. 事实基线

| 项 | 读数 | 出处 |
|---|---|---|
| 管理台 | `0.9.0`，12 域 + 3 入口（`main.mjs` / `cli.mjs` / `preload.cjs`），`engines.node >=24` | `architecture-manager/package.json` |
| 现行门禁 | `npm run conform` 五段全绿，`469 例 / 467 pass / 0 fail / 2 skip / valid=true`，digest `f6151a48…` | `versions/架构3.7.0.md` §2 |
| 源码快照范围 | 只扫 `{src,scripts,test}` + `package.json` / `package-lock.json` / `eslint.config.mjs` | `scripts/conform-proof.mjs:23` |
| 唯一机器来源 | 完全接入 = `readAdoptionCompletion()`（11 步全档且状态 ∈ {passed, auxiliary}）；最小接入 = L1 双格 | `src/domains/platforms/adoption-completion.mjs`、`versions/接入口径裁定-20261028.md` |
| 写通道既有约束 | `relayout`：备份 → 重铺 → 复验、`--dry-run`、幂等、失败回滚；onboarding：plan → checkpoint → audit → 回读 | `src/cli.mjs:20`、`domains/onboarding/*` |
| 治理硬约束 | 系统提示词 §9「若平台原生支持 MCP，则由**平台 bridge 负责适配**，底层仍须遵循相同 manifest、版本和权限规则」；`invocation-adapters-spec.md:223`「CLI 或 MCP 工具面至少其一，两者并存时语义须一致（同一协议、同一状态机）」 | 两份根级文本 |
| 软件面方向 | 用户 09-22 登记 `software` 仓目标形态为「经连接器 / MCP 链接调用」，只登记方向、未授权改判据；**D-60**：绿行只证明配方/快照/登记，不证明可派发 | `AGENTS.md:57`、系统提示词 §304 |
| 红线 | 已发布版本只读 · run 必钉版 · 哈希可回读 · 不谎报 · 未授权不写共享仓 / 不建一级目录 · 主机执行降级须当次同意 · 档位口径全工作流统一 | `versions/架构基本原则.md` |

## 3. 目标 / 非目标 / 架构决策

**目标**：在不改变任何既有动作语义的前提下，给管理台增加一个 stdio MCP 入口，把**读**能力默认开放、**写**能力收紧为逐调用确认，并让判据与文档同步。

**非目标**：不改三仓与共享 `current` · 不新增一级目录 · 不做七台 11 步出证（BP-2 不互抄）· 不改 `readAdoptionCompletion` 等唯一机器来源的语义 · 不绕过专家 `tool-lock` · 不引入 pre-push / CI hook · 不 bump 版本、不打包、不签名、不发 GitHub release · 不实现 A/B（已有）· 不重构 `docs-site` · 不做跨平台并行仲裁（BP-4 已撤销）。

| 决策 | 内容 | 理由 |
|---|---|---|
| AD-1 | **单一实现源**：每个 tool 直接调用既有 domain 导出函数，CLI 也调用同一函数；MCP 层只做协议编解码与确认 | §223 同一协议/状态机；避免两处逻辑漂移 |
| AD-2 | **std io JSON-RPC**，协议版本集合沿用 `mcp-config.mjs` 已支持的 4 个（`2024-11-05` / `2025-03-26` / `2025-06-18` / `2025-11-25`） | 与现有客户端校验面同源，不新增协议分叉 |
| AD-3 | **读默认开、写默认关**；写 tool 必须 `planId` + `confirmToken`，服务端复算 plan 字节哈希，不一致抛 `MANAGER_PLAN_DRIFT` | 保留既有 plan→checkpoint→audit→回读；fail-closed |
| AD-4 | **不暴露** git commit/push、发包、改共享 `current`、写他平台 `runtime/`、删除类动作 | 红线 + BP-2 平台隔离；MCP 不得成为绕过路径 |
| AD-5 | 审计落 `<platform>/runtime/manager-mcp/audit/<date>.jsonl`（平台私有，BP-4），含 tool / planId / 决策 / 哈希 / 时间戳；**不含凭据与业务输出** | 可回读、不进共享仓 |
| AD-6 | 新增判据**并进同一条 conform**（第 6 段 `manager-mcp`），负例注入；不另起全矩阵 | BP-3 三问：抓真失败、可增量、并进同一条 |
| AD-7 | **发布 ≠ 采纳**：源码入库但不 bump、不打包；README 明写「源码已进、发行未跟」 | 手工补签/双包发布成本高且与本轮目标无关；如需 0.9.1 另立发布轮 |
| AD-8 | 管理台是**产品平面**，其 MCP 入口不改治理架构平面的 BP / 三仓 / 平台对等判据；若平台要接，由该平台 `bridge` 自己适配 | 系统提示词 §9 |

## 4. 工具面（草案，P2 定稿时以 schema 为准）

**只读（默认开放，无副作用）**

| tool | 对应既有实现 | 返回要点 |
|---|---|---|
| `manager.scan` | `domains/resources/inventory.mjs#scanWorkspace` | `architecture-manager-inventory/v2` 原样 |
| `manager.readAdoption` | `domains/platforms/adoption-completion.mjs#readAdoptionCompletion` | 11 步状态、`pipelineEra`、是否 complete |
| `manager.threeLayer` | `domains/onboarding/*` 三层读数 | L1/L2/L3，与 `readAdoption` 同源 |
| `manager.governanceDrift` | `scripts/check-governance-drift.mjs`（只读调用） | 12 checks / failed / ok |
| `manager.runtimeDrift` | `scripts/check-runtime-drift.mjs`（只读调用） | mode / ok / drifted / pinStatus |
| `manager.conformStatus` | 读最近一次 conform evidence（**不触发跑**） | digest / ok / `sourceStable` / `recordedAt` |
| `manager.releaseGateDraft` | `scripts/release-gate.mjs`（只出草稿） | 两套门禁读数 + 四项读数草稿 |

**写（默认关闭，逐调用确认）**

| tool | 前置 | 约束 |
|---|---|---|
| `manager.relayoutPlan` | 无 | 返回 dry-run plan + planId + 计划哈希，**零写入** |
| `manager.relayoutApply` | 上一步 planId + confirmToken | 复算 plan 哈希；沿用备份 → 重铺 → 复验 → 失败回滚；`--dry-run` 结果不得直接当凭据 |
| `manager.onboardingPlan` | 无 | 只出 plan，不写配置 |
| `manager.onboardingApply` | planId + confirmToken | 走既有 plan → checkpoint → audit → 回读；不写他平台 `runtime/` |

**统一错误信封**：`{code, message, planId?, detail?}`，码集以 P2 schema 为准，至少含 `MANAGER_TOOL_UNKNOWN` / `MANAGER_CONFIRM_REQUIRED` / `MANAGER_PLAN_DRIFT` / `MANAGER_PLATFORM_SCOPE_VIOLATION` / `MANAGER_READONLY_TOOL_WRITE_ATTEMPT`。**未知 tool、缺确认、plan 漂移、跨平台路径一律 fail-closed**。

## 5. 变更清单（逐面）

| 面 | 文件 | 性质 |
|---|---|---|
| 新增服务端 | `architecture-manager/src/domains/manager-mcp/{server.mjs,tools.mjs,confirm.mjs,audit.mjs,errors.mjs}` | 新增 |
| 入口 | `architecture-manager/src/cli.mjs` 增 `mcp` 子命令；`package.json` 增 `mcp` script | 改（进 `sourceSnapshot`） |
| 共用域 | 既有 domain 模块只做**导出补齐**，不改函数体语义 | 改（最小） |
| 判据 | `scripts/conform.mjs` 增第 6 段；新增 `scripts/check-manager-mcp.mjs` + `test/manager-mcp.test.mjs` | 新增 + 挂入 |
| 文档 | `architecture-manager/README.md`、`docs/module-map.md`、`docs/发布门禁.md`、`docs/操作手册`、根 `README.md`、`versions/README.md` / `CATALOG.md` | 叙述补账 |
| 文档站 | `docs-site/data/docs-manifest.json` 若新增条目 + 白名单源文改动 ⇒ 按 AD-6/既有 `docs-site/README.md:100` 命令链重跑 build + conform 并重算源锁 | 联动 |
| 证据 | 负例输出、客户端回环记录、恢复/回滚说明；维护证据落本平台 `runtime/` | 新增，不入共享仓 |

**不改**：三仓任何已发布版本目录、共享 `current`、七台 `bridge.json` 钉版值、`readAdoptionCompletion` 判定语义、0.9.0 双包字节、冻结历史基线原文、一级目录清单。

## 6. 有序 P 表（③ 要求的完整判据载体）

**P1 只读盘点与回滚点（~2h，3 子块｜依赖：无）**
- 1a 逐份核对 §2 事实基线，产出「工具 ↔ 既有 domain 函数」映射表（每条 `路径:行号` + 是否需导出补齐）；
- 1b 全量查引用面：根级治理文本、`versions/`、`architecture-manager/docs/` 与 `scripts/`、`docs-site/data/docs-manifest.json` 白名单；逐条标注是否触发 C3/C9/C11；
- 1c 确认回滚点：HEAD 已推送且可 `ahead 0`（若否，先由用户终端推送，不代推）；新增文本先入库再动既有文件。
- **判据**：映射表与引用面清单落盘可回读、白名单命中项单独成表、回滚点 commit 存在；**停手点：零写入既有文件**。

**P2 契约定稿（~3h，4 子块｜依赖：P1）**
- 2a 定 tool 清单、逐 tool `inputSchema`/`outputSchema`、统一错误码集；
- 2b 定确认协议：`planId` 生成规则、计划哈希算法、`confirmToken` 时效与一次性、幂等键；
- 2c 定审计字段与落点（平台私有 runtime，BP-7 不入库件登记）；
- 2d 定负例清单（≥6 例）与「CLI / MCP 同结论」一致性判据的机器形态。
- **判据**：schema 可被 `ajv`/`jsonschema` 校验通过；负例清单每条可注入；`docs/发布门禁.md:43` 两处 glob 约束同批复核；**停手点：每子块一停，2d 单独一停**。

**P3 服务端实现（~3h，4 子块｜依赖：P2）**
- 3a `server.mjs` stdio JSON-RPC（initialize / ping / tools/list / tools/call），协议版本按 AD-2；
- 3b `tools.mjs` 逐 tool 调用既有 domain 导出（AD-1），补齐导出但不改函数体；
- 3c `confirm.mjs` + `audit.mjs`（AD-3/AD-5），`errors.mjs` 统一信封；
- 3d `cli.mjs` 增 `mcp` 子命令 + npm script；**旧 `npm run scan -- <root>` 用法零回归**（实盘回读 `architecture-manager-inventory/v2`）。
- **判据**：`node src/cli.mjs mcp` 可完成 `initialize → tools/list → tools/call` 回环；只读 7 tool 全部返回既有结构；lint 0 错；**停手点：每子块一停**。

**P4 负例判据与门禁收敛（~2h，3 子块｜依赖：P3）**
- 4a `test/manager-mcp.test.mjs`：未知 tool / 缺 confirmToken / plan 漂移 / 跨平台路径 / 只读 tool 试图写 / 协议版本不支持，≥6 例全被拒；
- 4b `scripts/check-manager-mcp.mjs` + 挂入 `conform.mjs` 第 6 段；整条 conform 注入负例须 `TOTAL false / exit 1`，恢复后 `ok=true`；
- 4c 「CLI 与 MCP 同结论」一致性用例：同一输入两条通道输出逐字可比部分一致。
- **判据**：负例全绿、注入使 conform 变红、恢复后全绿；**停手点：脚本落盘即停**。

**P5 文档同步与真实回环（~3h，4 子块｜依赖：P4）**
- 5a 更新 §5 全部文档，`docs/module-map.md` 补 manager-mcp 域、`发布门禁.md` 补第 6 段步骤构成与两处 glob；
- 5b `docs-site` 侧：仅当改了白名单源文才按 `README.md:100` 命令链重跑 `sync-docs` + `generate-reference` + `build` + `docs-conform`（internal / shareable），并重算 `sourceLockDigest` / `generatedDigest`；
- 5c 一次**真实 MCP 客户端回环**（非 mock）：`initialize` → `tools/list` → 只读 tool 调用 → 写 tool 的 dry-run plan → 拒绝无确认的 apply → 带确认的 apply（在临时工作副本，真实平台零触碰）；
- 5d 用户终端跑权威 `npm run conform`（P3/P4 改了 `sourceSnapshot`，`f6151a48…` 必然失效），回填新 digest；文档站侧读数单独登记，**两套 digest 不混用**。
- **判据**：`docs-conform` 双档 `PASS 11/0/0`（若触发）、真实回环证据可回读、新 digest 回填；**停手点：每子块一停，5b/5d 各单独一停**。

**P6 台账与入库收口（~2h，2 子块｜依赖：P1–P5）**
- 6a `versions/更新日志.md`、两份 README、收口记录补账；若本轮关闭/新增缺陷，按 `缺陷状态簿.check.py` 校验 `ok:true` 且 `closed.source` 指向盘上真实文件；
- 6b 四项读数（HEAD sha / 白名单 `git status` 空 / 远端一致 / 入库早于覆盖动作）+ 文档站侧 `git status` 与两套 digest 分别给出；推送由用户终端执行。
- **判据**：四项读数齐备、`ahead 0`、两套门禁全绿；**停手点：入库前后各一停**。

**依赖与顺序**：`P1 → P2 → P3 → P4 → P5 → P6`。P2 定契约，P3 才不会边写边改；P5d 必须在 P5b 之后（源文定稿才重算源锁）；P6 最后，否则台账与提交读数不自洽。**管理台 `conform` 与文档站 `docs-conform` 是两套独立门禁，任一套红都不算完成**（AD-6）。

## 7. 风险登记（非阻断，按 BP-5 只登记不当场修）

1. **digest 必然失效**：P3/P4 改 `src`/`scripts`/`test` 与 `package.json` ⇒ 现行 `f6151a48…` 不再代表源码；P5d 必须用户终端重跑约 11 分钟，不得用会话内结果冒充（会话内 5 例既有环境缺口是已知基线）。
2. **Electron 与 stdio 争用**：GUI 主进程与 stdio server 共用 stdout 会污染协议；须把 MCP 作为**独立 `cli.mjs mcp` 子进程**，不挂进 `npm start`。
3. **会话内子进程限制**：agent 进程树内 `spawnSync` 对部分 `.exe` EBUSY；真实回环（5c）可能须用户终端执行，届时如实登记、不谎报。
4. **越权写**：MCP 若成为绕过 plan/checkpoint 的通道即触红线；AD-3/AD-4 与 P4 负例是硬防线，不得为「方便」放宽。
5. **平台专有常量**：tool 参数/返回值不得出现平台 venv 路径、发行版名、release 特例（BP-2）；审计落点用相对占位。
6. **混合行尾**：`versions/更新日志.md` 为 CRLF 主体 + 末尾裸 LF；写入必须字节级替换并断言「新增行成对 CRLF、绝不引入新裸 LF」，事后 `git diff --numstat` 验无膨胀。
7. **发行未跟**：按 AD-7 不发包，0.9.0 安装包不含本轮源码；README 必须明写，避免误认已发布。
8. **`__pycache__` 污染**：任何 import 三仓发布目录模块的脚本必须 `python -B` + `PYTHONDONTWRITEBYTECODE=1`（D-46 家族），否则该平台此后每次 prepare 被 `HASH_MISMATCH` 拒。
9. **协议版本漂移**：不得让 `tools/list` 返回未经 P2 审阅的工具；`manager-mcp` 与 `native_mcp.py` 是两套客户端，名称相近但职责不同，文档须明写。

## 8. 完成判定（BP-5 / BP-6）

P1–P6 全部按各自**预先写明**的判据跑完即＝本轮完成；同一轮内不追加验收项、不提高门槛、不出现「跑完了还不算完成」。完成＝判据满足 + `run-lock.json` / 事件流 / 产物哈希等既有机制本来就在写并可回读。文档站全绿（若触发）是必要条件，不能只凭管理台 digest 宣布完成。收口报告必带四项读数与两套门禁读数；**无入库读数的「完成」按谎报处理**。等待型维护项（0.9.1 发包、七台出证、执行器切默认）归完成后的维护期。

## 9. 本方案不解决（需另立 P 表，不得顺手加码）

七台按 11 步口径各自出证与 `0 declaredAbsent` · 执行器试点切共享 `current`（用户单独决断 + 48h 观察窗） · `software` 仓全面转连接器/MCP 与 D-60 落差的工程实现 · `scriptEnvironmentRungs` 补档、契约兼容矩阵 · 文件数治理、D-175 备份区膨胀、其余 open 缺陷 · 管理台 0.9.1 打包发布 · `docs-site` 改版与生成管线重构 · 跨平台并行仲裁（BP-4 已撤销，代价明写） · A/B 两种 MCP 语义的既有实现重构。
