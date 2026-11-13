# VMware MCP 配方正式登记 — 执行 P 表（2026-11-07）

> **状态：用户 2026-11-07 指令「① 先把 VMware 这份正式登记进管理台」＝本轮实施授权。** 判据载体本文件 P1…P5；批准后照案执行，不即兴扩范围、不顺手重构、不中途改设计（BP-5）。
> **授权链闭合**：`software/VMware/versions/1.0.0/SOURCE.json` 记 `releaseStatus: published`（2026-11-06，qoder-cn 会话，user-approved P1–P5），且 `openDeferred[0]` 明写「registry.json entry: intentionally not applied without a separate shared-side approval」。本轮即那次**单独的共享侧批准**，不重复发布、不改已发布字节。
> **性质**：共享仓登记面维护，`agent/workflow = null`，未执行业务 run、未抬共享 `current`、未发包、未新增一级目录。

## 1. 事实基线（2026-11-07 只读盘点，逐条可回读）

| 项 | 读数 | 出处 |
|---|---|---|
| 配方形态 | `ai-software/v1`，`kind: mcp-stdio`，21 个固定 vmrun 工具，零 npm 依赖，Node >= 20 | `software/VMware/versions/1.0.0/manifest.json`、`README.md` |
| 封条 | `SHA256SUMS` **39 条 / 39 OK / 0 mismatch**；均为相对路径 | `sha256sum -c` 实跑 |
| 指针 | `current.json`：schema `ai-software-pointer/v1`、`id: vmware-workstation`、`version/available: 1.0.0`、`hashManifest: SHA256SUMS` | `software/VMware/current.json` |
| 已发布 | `SOURCE.json` 标 `published`；`openDeferred` 列 registry 登记待批准 | 同上 |
| registry 现状 | 6 条：burp-suite(`mcp-http`) / dirsearch / mysql-cli / nmap / veracrypt / wireshark-cli；条目键固定 `{id, current, enabled, kind, invocable, transports}` | `software/registry.json` |
| **硬判据** | `software_lint.py:304` 用 `root/ident/versions` 定位版本目录；`:290` 要求 `pointer.id == registry.id`；`:95` 要求 `manifest.id == registry.id`；`:306` 要求 `available == versions/` 枚举 | `tool/repo-lint/versions/0.7.0/scripts/software_lint.py` |
| **推论（不可回避）** | registry id 必须是 `vmware-workstation`（manifest 已写死），则资源目录必须同名 ⇒ **`software/VMware/` 须改名为 `software/vmware-workstation/`**；否则 `pointer-listing-stale` + `release-missing` + `manifest-id` 三处红 | 同上 |
| 已发布只读 | `versions/1.0.0/` 内所有字节**一个都不改**；`README.md:46-52` 的旧启动路径与 `E:\ai\qoder-cn\workspaces` 示例因此保留，登记为待 1.0.1 修正项 | 红线；`recipes/windows.json` 用 `${detectedPath}` / `${platformRuntime}` 占位，配方本体不含硬编码平台路径 |
| 门禁影响面 | `conform-proof.mjs:23` 的 `sourceSnapshot` 只扫 `architecture-manager/{src,scripts,test}` + 3 个根文件 ⇒ **改 software 仓不使 `f6151a48…` 失效** | 实读源码 |
| 文档站影响面 | `docs-manifest.json` 白名单**不含** `software/registry.json`、`software/README.md`、`versions/更新日志.md` ⇒ 本轮改动不触发 C3/C9/C11，无需重算源锁 | 实读 manifest |
| 治理漂移 | `check-governance-drift.mjs` 12 项不含软件资源数 ⇒ 加 1 条不使其 FAIL | 实读脚本 |
| 入库起点 | HEAD `f126eccc`，`origin/main` = `a4df1393`（**ahead 1**）；工作树 3 项：`M qoder/bridge/client-adapter.json`、`?? software/PacketTracer 8.0/`、`?? software/VMware/` | `git status --porcelain` |

## 2. 目标 / 非目标 / 决策

**目标**：把已发布的 `vmware-workstation@1.0.0` 按三仓同构正式登记进共享 registry，使管理台资源发现面可见，并跑通增量判据。

**非目标（写明，防扩范围）**：
- **不做平台网关注册**（`nativeMcpServers` / `bodies` / `softwareProfiles`）：`mcp-body.mjs` 要求真实 `mcp-discovery` 证据链（`MCP_DISCOVERY_CHANGED` 会拒），手工写等于绕过判据；按 BP-2 与 D-60 教训，派发能力由各平台自己出证，**登记 ≠ 可派发**。
- 不发 1.0.1、不改已发布 1.0.0 任何字节、不修 README 内的旧路径与示例平台路径。
- 不动 `software/PacketTracer 8.0/`（11-06 已裁定为登记例外，不入库、不纳入封条）。
- 不动 `qoder/bridge/client-adapter.json`（他平台配置面，BP-2 平台隔离；其改动非本轮引入）。
- 不改 `versions/平台接入清单.md` / `架构3.7.0.md`（文档站白名单源文，改则须按 AD-6 重算源锁）。
- 不做七台出证、不切执行器默认、不发包、不改管理台源码。

| 决策 | 内容 | 理由 |
|---|---|---|
| AD-1 | **只改父目录名，不改版本内字节** | 满足 `id == 目录名 == manifest.id` 的唯一不触碰已发布字节的路径；`SHA256SUMS` 用相对路径，父目录改名不影响封条 |
| AD-2 | registry 条目 `id: vmware-workstation`、`current: vmware-workstation/current.json`、`kind: mcp-stdio`、`invocable: false`、`transports: []` | 键集与 C-5 一致；`invocable/transports` 由 `typeNote` 钉死，配方可达只经 workflow `software-call` 阶段 |
| AD-3 | 本轮登记归**共享侧**，平台侧派发注册另案 | BP-2 结论不互抄；D-60「绿行不证明可派发」 |
| AD-4 | 只提交本轮路径，精确 `git add` | 避免把他平台改动与用户登记例外一并入库；四项读数如实报工作树剩余项 |

## 3. 有序 P 表

**P1 只读盘点与回滚点（~1h，2 子块｜依赖：无）**
- 1a §1 全表读数落盘（已完成，本文即产物）；
- 1b **先把本文件与线 B 方案文档入库提交**，形成可回滚 commit（BP-6：破坏性动作前先有 commit）；记录 HEAD。
- **判据**：盘点结论可回读、回滚点 commit 存在；**停手点：零写入共享仓**。

**P2 资源目录正名（~0.5h，2 子块｜依赖：P1）**
- 2a `software/VMware/` → `software/vmware-workstation/`（整体 `mv`，未跟踪目录，零字节销毁）；
- 2b 复验：40 个文件数一致、`sha256sum -c` 仍 **39/39 OK**、`current.json`/`manifest.json` 字节哈希前后不变。
- **判据**：`root/vmware-workstation/versions/1.0.0/` 存在且封条全绿；**停手点：改名后即停，不碰版本内文件**。

**P3 共享侧登记（~0.5h，2 子块｜依赖：P2）**
- 3a `software/registry.json` 追加第 7 条（AD-2 字段），并在 `compatibility.axes.selectionKey.alignedNow` 追加 `software/vmware-workstation/current.json`；
- 3b `software/README.md:41`「六个配方逐件登记」→「七个配方逐件登记」，并补一句本轮登记说明。
- **判据**：registry 7 条 / 无重复 id / 键集合法；两处文本与实盘一致；**停手点：写完即停**。

**P4 增量判据（~1h，3 子块｜依赖：P3）**
- 4a `repo-lint 0.7.0 --scope snapshot` 带 `--software-root`，检查 software 面 **0 error**（`python -B` + `PYTHONDONTWRITEBYTECODE=1`，严禁向发布目录写 `__pycache__`，D-46 家族）；
- 4b `platform-conformance 1.6.3` 的 `conform --config workbuddy/bridge/workbuddy-config.json --only vmware-workstation`：单格冒烟，`unionSha256` 整体仍算一次，`unknownOnlyIds` 为空；
- 4c `check-governance-drift.mjs` fail 模式 `ok=true`；会话内无法达成的项**如实登记、不降门槛**。
- **判据**：4a/4c 全绿；4b 单格被真实判定（PASS 或带 `gapPlan` 的非 PASS 均可，不得判「什么都没判」）；**停手点：每子块一停，报告落临时目录不落仓**。

**P5 补账与入库收口（~1h，2 子块｜依赖：P4）**
- 5a `versions/更新日志.md` 追加本轮条目；本文件补「执行读数」段；`versions/README.md` / `CATALOG.md` 的本轮新增文档索引可按需补（非白名单源文，不影响源锁）；
- 5b 精确 `git add` 本轮路径 → commit → 四项读数（HEAD sha / 白名单内 `git status` 空 / 远端一致 / 入库早于改名动作）；**如实记录**工作树剩余项与未推送状态。
- **判据**：四项读数按实盘给出、不谎报；**停手点：入库前后各一停**。

## 4. 风险登记（非阻断，只登记不当场修）

1. **已发布 README 路径失效**：改名后 `README.md:46` 的 `node E:\ai\software\VMware\versions\1.0.0\src\server.mjs` 与 MCP 客户端示例路径不再成立；已发布只读 ⇒ 本轮不改，登记为 **1.0.1 修正项**，收口记录给出正确路径。若用户已有客户端按旧路径配置，需按新路径更新。
2. **README 示例含平台专有常量**：`:52` 的 `E:\ai\qoder-cn\workspaces` 属示例文本，非配方字段；`recipes/windows.json` 用占位符，配方本体合规（BP-2）。登记为 1.0.1 一并改为 `${platformRuntime}/workspaces`。
3. **登记 ≠ 可派发**：按 D-60，registry 绿行只证明「配方解析 + 快照冻结 + 本体登记」，不证明平台能起该 MCP；平台侧 `nativeMcpServers` 注册须各平台会话按 intake 流程自证。
4. **`unionSha256` 会变**：新增一个软件资源会改变共享侧能力并集摘要，属预期结果；本轮只做 `--only` 单格，不重跑全矩阵（BP-3）。
5. **工作树既有 3 项**：`qoder/bridge/client-adapter.json` 的 M、`software/PacketTracer 8.0/` 的 `??` 非本轮引入、不动；因此「白名单内 status 空」按**本轮路径集合**界定，全仓 `git status` 仍非空须如实写明。
6. **未推送**：起点已 ahead 1；本轮新增提交后 ahead 更多，推送须用户终端单独执行，推送前不把本轮称作「远端一致」。

## 5. 完成判定（BP-5 / BP-6）

P1–P5 按各自**预先写明**的判据跑完即＝本轮完成；同一轮内不追加验收项、不提高门槛。完成＝判据满足 + 既有产物（封条、指针、registry、收口读数）可回读。**等待型维护项**（1.0.1 README 修正、平台侧派发注册、用户终端可选重跑全量 conform、git 推送）归完成后的维护期，不计入本轮判据。收口报告必带四项读数；无入库读数的「完成」按谎报处理。

## 6. 执行读数（2026-11-07，判据逐条对照）

| P | 判据 | 实盘结果 |
|---|---|---|
| P1 | 盘点可回读 + 回滚点 commit | §1 表落盘；回滚点 `64d5254c`（两份文档单独提交，早于任何改名动作）✅ |
| P2 | 改名后封条全绿、文件数一致 | 41 → 41；3 份关键文件 sha256 逐字一致；`sha256sum -c` **39/39 OK** ✅ |
| P3 | registry 7 条、文本一致、无 EOL 膨胀 | 7 条 / 无重复 id / 键集合法；`alignedNow` 同步；diff `10+/1-` 与 `3+/1-` ✅ |
| P4a | software 面 0 error | **按既有基线口径达成**：4 errors 全为既有（nmap ×3、`_connector` ×1，与 10-30 读数一致），**`vmware-workstation` findings 0**，资源解析为 `mcp-stdio / 1.0.0 / 21 capabilities / windows`。绝对 0 error 未达成，不谎报为 0；全仓 `--scope snapshot` 在会话内被 SIGTERM，改用 `software_lint.lint_software_root` 直调（隔离 venv `jsonschema 4.25.1`，`python -B` + `PYTHONDONTWRITEBYTECODE=1`，发布目录 `__pycache__` 复查 0） |
| P4b | 单格真实判定 | `onlyIds=['vmware-workstation']` / `unknownOnlyIds=[]` / `perOnlyId` 判 1 行 `unverified` / **`remediationMissing=[]`** / `unionSha256=44f2f9fd76de…` ✅；`floorReached=False` 因该行未验证，属诚实读数（可在平台侧派发注册后翻正）。为让缺口带出路，本平台 `gapPlan` 增 `software:vmware-workstation`（`costMinutes: 90`），未代其它平台声明 |
| P4c | governance-drift fail 模式全绿 | `ok=true / failed=[]` ✅；另复验 `check-runtime-drift.mjs` `ok=true / drifted=[]` ✅ |
| P5 | 补账 + 四项读数 | `versions/更新日志.md` 追加本轮条目（字节级、CRLF 计数 884 不变、diff `11+/0-`）；四项读数见 `versions/VMware-MCP配方登记-收口记录-20261107.md` |

**影响面复核**：`conform-proof.mjs:23` 的 `sourceSnapshot` 不含 software 仓 ⇒ 现行权威 digest `f6151a48…` 未失效；`docs-manifest.json` 白名单不含本轮改动的 3 份治理文本 ⇒ 不触发 C3/C9/C11，未重算源锁（BP-3 最小量）。

**执行期新登记（非阻断，按 BP-5 只登记）**：① 已发布 `1.0.0/README.md:46` 的启动示例仍指旧目录 `software/VMware/...`，`:52` 示例含平台专有路径 `E:\ai\qoder-cn\workspaces`；因已发布只读，二者均**未改**，登记为 1.0.1 修正项，用户若已按旧路径配置 MCP 客户端需更新为新路径 `software/vmware-workstation/versions/1.0.0/src/server.mjs`。② 平台侧 `nativeMcpServers` 派发注册未做，登记 ≠ 可派发（D-60）。③ 工作树起点即有 `M qoder/bridge/client-adapter.json` 与 `?? software/PacketTracer 8.0/`，均非本轮引入、未动；全仓 `git status` 仍非空须如实写明。
