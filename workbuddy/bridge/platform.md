# WorkBuddy 平台章

> 维护者：仅 **workbuddy 会话**改本文件。

> **〔2026-09-22 治理口径更正（由 qoder 会话依用户「连平台章一起校订」的一次性授权代为登记；本章任何机检读数一字未改）〕** 三条复述型条款在本章的旧措辞请按此读法：① 凡「数模求解链（`math-solver-chain`）不承接」「交稿级须先确认目标平台已声明并验证」「不要默认转 zcode 交稿」一类句子，保留为**当时的实测快照**，不再是调用规则——用户 09-22 裁决**数模与其它 agentic workflow 等同**，`math-solver-chain` 不再是各平台需声明的能力项，环境需求按 BP-1 §1.6 三选一归属（见 `versions/架构基本原则.md` §9 第 11 条、`invocation-adapters-spec.md` §3.1）。② 凡「跨平台资源仲裁未满足 / 需用户单独授权」，该项自同日起**已从必需项中撤销**：续跑只需「版本一致性校验 + 带 sha256 的可回读交接载体」两项，平台内锁表即正确形态；代价明写在条文里（同一项目被两客户端同时开工不会被发现、会互相覆盖）。③ 判据 harness 的现行合法路径是 `tool/architecture-ops/versions/1.2.0/architecture_ops/invocation_matrix.py`（或本平台自己 `bridge/ops/` 那份）——旧 `zcode\workspaces\agentic-workflow-implementation\` 工作区 2026-09-17 已删除，任何指向它的命令行都跑不通。本节不改动本章任何 baseline 数字；如与本节冲突，**以本平台 baseline 件为准并回改本节**。其他平台不得改写。总框架：[../../HANDOFF.md](../../HANDOFF.md)；架构基线：[../../versions/架构1.0.0.md](../../versions/架构1.0.0.md)；接口与判据：[../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §8 / §9 / §10。

## 状态

**第 7 运行平台**（2026-09-16 经用户授权接入并验收；根级同步见 `../../HANDOFF.md` §一/§三）。接入判据为规范 §8 的机械验收：**invocation 矩阵 r3 `PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0`，40 行**（`../runtime/matrix-smoke/workbuddy-matrix-20260916-r3.json`）。38 个业务资源（25 工作流 + 13 专家）全部经 `/wf` `/wfa` 语义可调用；两条例外与 zcode / qoder / doubao 例外面一致（`wf-runner` 设计、`repo-lint` 策略不可兑现），按实测错误码 `CAPABILITY_UNAVAILABLE` 登记在 [invocation-exceptions.json](invocation-exceptions.json)。

> 上面这段是 **2.x 引擎时代**的接入基线与判据，原样保留。**2026-09-21 起本平台现行判据已换成架构 3.0.0 采纳轮的全矩阵 45 格读数**（`PASS 38 / NEEDS-INPUT 1 / EXPECTED 6 / FAIL 0`），见下节「架构 3.0.0 采纳」；两条例外中的 `repo-lint` 一条已随本轮重审改码（见该节与 `invocation-exceptions.json` 的 `previous`/`selfExpiring`）。**2026-09-23 起现行判据再换成架构 3.1.0 采纳轮的 48 格读数**（`PASS 43 / NEEDS-INPUT 1 / EXPECTED 3 / FAIL 1`，其中那 1 格 FAIL 已定位到共享侧 Agent 释放的锁缺陷、不是平台缺口），见下节「架构 3.1.0 采纳」；3.0 那版读数作为上一代基线保留。

> 矩阵执行方式说明（如实）：本会话沙箱对单条命令的子进程总量有限制，整版矩阵两次被终止（r1@20 / r2@24 run 目录留证，直调同一资源均成功——引擎无故障）；最终按 `--only` 分 38 片执行、机械合并为 r3 报告，provenance 与全部分片报告随报告留档。每片均为 invocation_matrix.py 的规范输出，行内容与整版运行同构。

钉版（本平台自决，不动共享默认）：引擎 `wf-runner 0.6.0`（共享 current 0.5.2）、契约 `repo-lint 0.2.1`（platform 枚举已含 `workbuddy`）、环境 = 本平台自建 Windows venv（`../runtime/py-env`，python 3.9.13，runner requirements.lock 8 库逐版本匹配 + matplotlib 3.9.4 / numpy 1.26.4 供 renderer profile；逐包版本见 [environment.json](environment.json)）。

## 架构 3.0.0 采纳（2026-09-21，platform-side P1–P6）

**结论**：本平台已采纳 3.0 的**软件面**并改按 3.0 引擎运行；生产四件接入文件已更新并逐字节留档；判据为一次全矩阵 **`PASS 38 / NEEDS-INPUT 1 / EXPECTED 6 / FAIL 0`（45 格 = 39 工作流/专家 + 6 软件格）**。全程只做本平台，不改共享 `current.json`，不代他平台申报。

| 面 | 采纳后（生产） | 采纳前（已留档） |
|---|---|---|
| 引擎 | `wf-runner 0.9.0`（含 `software-call` 动作与七步门链） | `0.6.0` |
| 契约 | standalone 包 `runtime-contracts 1.3.0` | `repo-lint 0.2.1`（legacy 布局） |
| 扫描器 | `scannerRelease = repo-lint 0.4.0`（standalone 契约包的硬要求） | —（legacy 布局下即契约版本，无此键） |
| 软件面 | `softwareRoot` / `softwareGateway`（参考网关 1.0.0）/ `softwareGatewayConfig` / `softwareEnvironment` / `interpreters[".py"]` / `softwareProfiles(readonly-observe)` | 无（3.0 新面） |
| 平台默认 | `bridge.json: defaults.workflowVersions["repo-lint"] = "0.4.0"` | 无 |

四件接入文件（采纳后 sha256）：`workbuddy-config.json 04451596…`、`capabilities.json 2ebbe9d3…`、`invocation-exceptions.json a7ec32be…`、`bridge.json ab974057…`。采纳前四件**逐字节**备份（含 sha256/size/mtime 清单）在 `../runtime/maintenance/3.0-adopt/pre-adoption/`；判据、逐步证据与全部如实说明在同目录 `P-TABLE.md`，机器读数在同目录 `baseline/`。

**已入仓（2026-09-21，P6）**：接入件提交至 `main`，提交 `002f1eee`（父 `6f757bfa` = codex 的 3.0 提交；作者 `qoder-bp-sync <qoder@eai.local>`，本仓既有身份）。11 件**全在 `bridge/` 内**（改写 5 + 接入新件 2 + 候选留证 4），`git show --name-only` 里非本目录路径 0 条；同批 qoder 在途改动（`qoder/bridge.json` 等）**未入本轮提交**。故本目录即本平台 3.0 的**可核文本层**。

**新增的实证面（本平台自证）**：
- **软件面门链真跑**：`software-call` 的门链在真引擎上跑到 `declared:passed → snapshot:refused`（7 门顺序 declared/snapshot/profile/boundary/consent/arguments/idempotency），C-4 拒绝码 `CAPABILITY_UNAVAILABLE` 取自引擎的 `Rejected.code`；拒绝发生在**派发之前**——无 `evidence/software-calls`、无 `software-intents`、平台 `evidenceRoot` 前后逐文件未变。
- **网关只读面真跑**：inventory 6/6、instance status 6/6（`idle`）、5 条声明只读自检 capability 全数被拒且不落证据。
- **提示词面不回退**：`game-sprint-plan@2.1.1` 真闭环（prepare→next→stop）在**最终生产字节**上重跑通过（`lockSha256 722f58aa…`）；`conform` 在生产字节上与候选字节**逐字相同**（`union=2b73555b249f items=27 pass=18 declaredAbsent=9`）。
- **平台自带默认的守法用法**：`bridge.json` 的 `defaults` 由共享权威工具 `architecture-ops 1.2.0 switch_defaults` 写入（`plan → apply → verify`，CAS + checkpoint，`sharedCurrentTouched=false`）——它不改共享指针，只表达"本平台实际运行的扫描器版本"。

**边界与未做（不写成已具备）**：
- 六配方 `capabilities.snapshot.json#frozen` 全为假（共享侧 D-47，作者侧待补齐）⇒ 任何真实 `software-call` 在 snapshot 门 fail-closed。已登记为六条例外（`expectedCode=SNAPSHOT_NOT_FROZEN`）。**没有执行过任何一次真实软件调用**。
- 脚本隔离沙箱仍缺（待办 W1 不变）⇒ `action:script` 阶段、`repo-lint` 的脚本面、数模求解器链仍不可执行。
- **不翻共享 `current.json`**（D-52）：共享仍指 `wf-runner 0.7.9` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0`；抬针是各平台同批采纳动作，本平台不得单方面执行。
- 本轮**未做**：配方快照冻结（共享软件仓作者侧）、跨平台设备/端口仲裁（C-8）、48h 观察窗口。
- **一处平台间不等（BP-2 待补台账）**：根 `.gitignore` 第 54 行 `/workbuddy/*` 把 `workbuddy/runtime/**` 整体排除，故本轮 P 表与全部 baseline 证据留在平台私有目录、不进版本历史；而 `qoder/` 带一个已入仓的平台级嵌套 `.gitignore`（`qoder/.gitignore`），把 `runtime/maintenance/`、`runtime/reports/`、`runtime/probes/` 等留证目录重新放行。这是两平台在**仓策略**上的差异（不是能力差异），按 BP-2 只登记待补；改法很小（新增 `workbuddy/.gitignore` 一行 `!/runtime/maintenance/`，**不需**动根 `.gitignore`），但需用户单独授权。**2026-09-21 采纳轮已按用户裁定只提交 `bridge/`**，故该不等保持登记态、未顺手补齐。

## 架构 3.1.0 采纳（2026-09-23，platform-side P1–P7）

**结论**：本平台已按 3.1 代际运行并完成自证，判据为 **一次全矩阵 48 格 `PASS 43 / NEEDS-INPUT 1 / EXPECTED 3 / FAIL 1`** + `conform` 地板 `pass 21 / declaredAbsent 6 / unverified 0 / remediationMissing 0`。全程只做本平台，不改共享 `current.json`、不写共享三仓、不代他平台申报。**那 1 格 FAIL 不在本平台**（根因与处置见下「共享侧缺陷」）。判据、逐步证据、全部偏离与如实说明在 `../runtime/maintenance/3.1-adopt/P-TABLE.md`，机器读数在同目录 `baseline/`。

**已入仓（2026-09-23，P7）**：本轮接入件提交至 `main`，提交 `c1f6a9a5`（全哈希 `c1f6a9a518933ad98079ecd04593438322b39c28`，提交时间 `2026-09-23 17:03:53 +0800`；父提交 `5f7fea5c` = doubao 的 3.1 接入提交，故本平台排在它之后，未插队）。`git show --name-only` 共 **5 件，全部在 `workbuddy/bridge/` 内**（`workbuddy-config.json`、`capabilities.json`、`invocation-exceptions.json`、`environment.json`、`platform.md`），非本目录路径 **0 条**；提交后本平台工作树 `git status --porcelain -- workbuddy` 为空、索引无差异 ⇒ 入仓的就是 P6 那一批**同一批字节**。同批他平台在途改动（当时工作树里 `doubao/bridge/*` 三件与 `qoder/runtime/**` 一件为 modified）**未入本轮提交**。**远端读数如实**：`git ls-remote origin HEAD` 本轮取不到（`CONNECT tunnel failed, response 502`，本机代理到 GitHub 的通道不通），按最后一次 fetch 的远端 ref 记本地领先 `origin/main` 22 个提交；**未推送**（无授权，且禁强推）。**自指说明**：本节要记的正是这次提交自身的哈希，而提交哈希不可能写在它自己的内容里，故本段由紧随其后的第二次提交落盘——与 3.0 轮同一结构性处置。

| 面 | 采纳后（生产） | 采纳前（3.0 轮） |

|---|---|---|
| 引擎 | `wf-runner 0.10.0`（F-1 上下文注入 / F-2 场景展开 + `expandedGraphSha256` / 执行面六格 / D-62 档位可见） | `0.9.0` |
| 契约 | `runtime-contracts 1.4.0`（`CONTEXT_UNRESOLVED` / `HANDOFF_VERSION_MISMATCH` 进枚举；`execution.{scenario,expandedGraphSha256,contextSkills,rigorSource}`） | `1.3.0` |
| 扫描器 | `scannerRelease = repo-lint 0.5.1`（v3 流程定义 schema、常开 R2、R16 治理文本机检、R5 场景守卫） | `0.4.0` |
| 判据工具 | `architecture-ops 1.3.0`（digest `de1a7b62…`）/ `platform-conformance 1.4.0` | `1.2.0` / `1.3.0` |
| 平台默认 | `bridge.json: defaults.workflowVersions["repo-lint"] = "0.5.1"`（`switch_defaults plan` 复核：`from=to=0.5.1`，本步零写入） | `0.4.0` |

**本轮改的字节只有一处**：`workbuddy-config.json` 的 `bridge` 键由 `bridge/bridge-candidate-090.json` 改指正式 `bridge/bridge.json`（+ `notes_20260923` 说明）。这不是文字整理，而是一处真缺陷的收口：3.0 轮把「平台作用域默认」写在正式 `bridge.json`，但配置指向的候选副本当时与它**逐字节相同**（同为 `ab974057…`，都是 `repo-lint 0.4.0`），故无行为差异；3.1 整理轮只把正式件抬到 0.5.1，两份自此分叉，**任何不带版本的 `repo-lint` 调用**都会读到 0.4.0 并与 `scannerRelease 0.5.1` 撞上引擎的 fail-closed。改前/改后两条真电池（请求不带版本、请求写 `current` 两种别名形态）：

| 形态 | 改前 | 改后 |
|---|---|---|
| `repo-lint` 入口别名（`target.version` 缺省或 `"current"`） | `VERSION_CONFLICT: Selected workflow:repo-lint@0.4.0 conflicts with this platform's scannerRelease repo-lint@0.5.1; align the pin or request 0.5.1` | 不再冲突，请求抵达入参校验：`INVALID_REQUEST` + 诊断件 `'toolRoot' is a required property`（即 NEEDS-INPUT：合成参数不可能满足 `scope=live ⇒ toolRoot=/shared/tool`） |

**新增的实证面（本平台自证，逐条有机器读数）**：
- **全矩阵 48 格**（`baseline/p3-matrix.json`）：分母 **42 工作流/专家 + 6 软件格**（3.1 新增三条流程后由 45 涨到 48）。**一次单条命令跑完，未分片、未机械合并**——3.0 轮 `--only` 分 38 片 + 机械合并的做法本轮不需要。软件 3 格 PASS、3 格 EXPECTED（见下）。
- **F-1 上下文注入真跑**：`novel-pipeline` 指定场景 `outline` ⇒ 锁内 `contextSkills` 2 个、prompt 32,573 字符含该 2 份技能正文；不指定场景 ⇒ 7 个、159,041 字符含 7 份正文。「场景点名以场景为准、未点名回落工作流声明」在真字节上成立，且技能正文**确实进了提示词**。
- **F-2 场景与展开图哈希真跑**：5 个互异摘要（`game-pipeline` standard/gdd；`novel-pipeline` standard/outline/hook）；未知名场景被拒且列出全部 12 个已声明场景；对 v2 定义传场景被拒并点名 `definition schema: ai-workflow-definition/v2`。**续跑失配 ⇒ `VERSION_CONFLICT` 那一支未测**（要改已发布字节才能触发，红线 1），登记于 `capabilities.unverified`。
- **档位可见真跑（D-62）**：未写档位 ⇒ `rigor=balanced / rigorSource=default`，认领报文带 `tierNotice`「defaulted, and no tier written means draft」；写 `rigor=full` ⇒ `rigorSource=declared`。同一场景两种档位下展开图哈希相同（档位不改图）。
- **能力地板（conform 1.4.0）**：`union=75a89e670df7`（本平台用 Get-FileHash 独立复算 `--union-out` 字节，与报告值逐字相符 ⇒ 第三方可复现）；非绿 6 行**全部带 gapPlan**（改什么 + 成本），`remediationMissing` 由 9 降为 0，`floorReached=false` 如实保留。
- **CAP-01 阴性对照**：本轮首次给 `descriptor` 加 `actions`，加跑一格含 4 个 `action: script` 阶段的流程（`math-modeling-programmer@1.7.2`）⇒ **PASS**，证明 `descriptor.actions` 对引擎执行面惰性、只对 conform 可读（引擎的 CAP-01 只认 `descriptor.schema == ai-platform-descriptor/v2` 字面量）。
- **声明口径对齐（一处，PEP 503）**：`environment.json` 的 `PyYAML` / `typing_extensions` 改为 `pyyaml` / `typing-extensions`（版本未改）。原因：conform 的并集侧归一名、裁决侧比原名（`conform.py:127` vs `:177`），两个已装已声明的包被读成 declaredAbsent；引擎解析 requirements 两边都归一（`resolution.py:135`），故对执行面无影响。实测两行转 pass。

**非绿格逐条（不写成已具备）**：
- `workflow:repo-lint@0.5.1` **NEEDS-INPUT**：合成参数不可能满足 `scope=live ⇒ toolRoot=/shared/tool`，harness 定义如此，不是可调用性失败。
- `software:{dirsearch,mysql-cli,wireshark-cli}@1.0.1` **PASS**（共享侧 3.0-Q Q-P3 冻结能力快照后由 EXPECTED 翻正，本平台网关 inventory 实测 `frozen=true` + 本体已登记）。
- `software:{burp-suite,nmap,veracrypt}@1.0.0` **EXPECTED / SNAPSHOT_NOT_FROZEN**：本体均已登记、能力条数 4/3/4，快照未冻结的原因各不相同（nmap 真 CLI 无 `-oJ` 与配方声明不符（共享侧 D-61）／veracrypt 为 GUI 无 stdout／burp-suite 端点未监听）。按用户 2026-09-23 裁定：**软件仓问题默认忽视**，只登记不追改。

**共享侧缺陷两处（实测发现，本平台只登记不修，属共享仓写入、无授权）**：
1. **`agent:mastermind-bug-bounty@4.0.0` 不可调用（本轮唯一 FAIL）**：其 tool-lock 仍钉 `workflow:mastermind-bug-bounty@3.0.0`，而 3.0.0 的定义件写 `version: "2.0.0"` 与 manifest 不符 ⇒ 扫描器判 `definition-mismatch`、引擎 fail-closed 阻断闭包（已发布不可变，3.0.0 修不了）。共享侧随后发的修复释放 **3.0.1** 定义已正确并把 current 抬过去，**但没有同步抬 4.0.0 的锁**。共享侧自己的 `repo-lint 0.5.1` 报告同时记下了这两条事实（唯一 error + agent 4.0.0 的 `lockedWorkflows`），只是未把二者连起来。**处置路径**：Agent 侧作者体重发一版抬锁（或按已发布不可变规则另发补丁释放）；在本平台侧无正解（Agent 内部锁不由平台作用域默认覆盖，`resolution.py:60-62` 实测）。**未登记为 EXPECTED**——把真失败记成例外会让「FAIL 0」变成谎话。
2. **`runtime-contracts 1.4.0` 的静态 fixture 未跟上契约版本**：`platform-conformance` 套件 15 项中 8 passed / 1 failed / 6 skipped；唯一失败是 `test_contracts.test_package_runs_standalone`（`validator exit != 0: {"passed":60,"failed":25}`，旧 fixture 缺 `execution.scenario` / `expandedGraphSha256` 等 1.4.0 字段）。**与平台无关**（静态自检，任何平台同读数），共享侧 3.1 收口文件亦如实记为未达成项。6 项 skip 是本平台未声明 `descriptor.evidenceBindings`（套件按设计报 absent 而非 PASS）。

**边界与未做（不写成已具备）**：
- `repo-lint 0.5.1` 在本平台**跑不了**，本轮拿到了它自己的拒绝报文：`live scope requires the platform's read-only jail mounts for every root it is given: /shared/tool, /shared/agent and, when a software root is passed, /shared/software (D04 declaration; BP-1: one binding set for all three roots)`；`snapshot` 口径需要把三仓复制进平台运行目录（`tool/` 实测 20,222 文件 / 467.6 MB），撞 BP-7 的隔离口径与 BP-3 的最小量，故不做。P 表该判据已如实改写为「取得并留档工具自身的拒绝读数」并登记。
- 脚本隔离沙箱仍缺（W1 不变）⇒ `action:script` 阶段、`repo-lint` 的脚本面、数模求解器链仍不可执行；两条 permission-triple（脚本面）与 `python-package:pymupdf` 同属这一根因。
- `action:peer`（未声明 peerDispatch / 无派发器）与 `profile:administrator`（软件面提权档）未声明。
- 架构 3.1.0 §6 的 T-P3b 九格端到端（真派发脚本 / 真 kill 受管进程 / 真让网关答 busy / 环境根拼错的真拒绝）**未跑**：需带 `scriptEnvironmentRungs` 与网关运行面的平台实盘出证，本平台没有该面（登记于 `capabilities.unverified`）。
- **不翻共享 `current.json`**：共享已在 3.1 整理轮切代（`0.10.0 / 1.4.0 / 0.5.1 / 1.3.0 / 1.4.0`），本平台只是跟随声明，未单方面改任何共享指针。
- **仓策略不等保持登记态**：`workbuddy/runtime/**` 仍按根 `.gitignore` 第 54 行不入仓，故本轮的 P 表与全部 baseline 留在平台私有目录。



## 架构 3.2.0 采纳（2026-09-25，platform-side P1–P7 = 定稿实施表 P7 行在本平台落地）

**结论**：本平台已按 3.2.0 成套代运行并完成受影响面自证——**成套切代** `wf-runner 0.10.1` / `runtime-contracts 1.4.1` / `repo-lint 0.5.2`（+ 判据工具 `architecture-ops 1.4.0` / `platform-conformance 1.4.1`），**软件派发面从参考网关换绑到共享连接器 `_connector/1.0.6`**，连接器电池 **13/13**、矩阵软件 6 格 `PASS 3 / EXPECTED 3 / FAIL 0`、`conform` 与换绑前逐字同值（`pass 21 / declaredAbsent 6 / unverified 0 / remediationMissing 0`）。**不跑全矩阵**（BP-3：补丁代不做整版；3.1 轮的 48 格读数仍是现行全矩阵基线）。判据与全部读数在 `../runtime/maintenance/3.2-adopt/P-TABLE.md`。

| 面 | 采纳后（生产） | 采纳前（3.1 轮） |
|---|---|---|
| 引擎/契约/扫描器 | `wf-runner 0.10.1`（process gate at-most-once）/ `runtime-contracts 1.4.1`（run-lock v1.2 的 scenario 字段兼容）/ `repo-lint 0.5.2`（--select 单机 30.1s） | `0.10.0` / `1.4.0` / `0.5.1` |
| 平台默认 | `bridge.json: defaults.workflowVersions["repo-lint"] = "0.5.2"`（`architecture-ops 1.4.0 switch_defaults` plan→apply→verify，readback 0.5.2） | `0.5.1` |
| 软件派发面 | **`software/_connector/versions/1.0.6/connector.py`**（七入口 list/describe/health/call/session/artifact/evidence） | `_gateway/1.0.0/gateway.py`（参考网关） |
| gateway config | 删 `platform` 键 + 加 `interpreterAliases(PPython→本机 3.12.4 实测)`、`allowedHosts(回环)`、`allowGuiLaunch:false`；**不声明** credentialProvider 与 session 三 provider | 无这些键 |
| 判据 harness | `architecture-ops 1.4.0`（`invocation_matrix.py` 与 1.3.0 **逐字节相同**，digest 同为 `de1a7b62…`；1.4.0 只新增 `switch_current.py`）——provenance 记 digest+packageRoot 双值 | `1.3.0` |

**换绑的实测依据（D-93 家族，两条真电池）**：用引擎原样（无 `kind`，`engine.py:643/:727`）的 `software.health` 消息打参考网关 `_gateway/1.0.0`，两种信封形态都答 `INVALID_REQUEST: unknown gateway request schema` ⇒ 3.2 管理面在旧绑定下**整体不可达**；同一消息打连接器 `_connector/1.0.6` 答 `ok=true`、6 行 health。证据：`p2-battery-gateway-before.json` / `p2-battery-connector-before.json`。

**连接器电池 13/13（引擎原样消息直驱，`p3-connector-battery-rerun.json`）**：
- **可派发 3**：`dirsearch@1.0.1`、`mysql-cli@1.0.2`、`wireshark-cli@1.0.1`（快照 frozen + 本体在盘核验 `bodyDigest=ok`）；**三条真派发**（各 `--version`，exit 0，带编号证据对）：`dirsearch v0.4.3`（经本机 PPython 3.12.4 别名解析）、`mysql Ver 8.0.39`、`TShark 4.2.6`。
- **不可派发 3，逐条点名**：`burp-suite`（快照未冻结 + 本体未登记）、`nmap`（快照未冻结 + 配方 pin 65 字符）、`veracrypt`（快照未冻结）——与矩阵软件 6 格逐行一致（`p4-matrix-software.json`；**D-94 口径**：1.4.0 矩阵会把未归类网关错误落成 PASS，故以直驱电池为权威、矩阵为对照）。
- **拒绝格全部结构化且发生在派发前**：`mysql-cli@query`（无 credentialProvider ⇒ 点名 `configKey: credentialProvider`）、`nmap@scan`/`veracrypt@version`（snapshot 门 `CAPABILITY_UNAVAILABLE`）、`burp-suite@version`（点名 offered operations）、`session.open`（gateway config 无 softwareProfiles ⇒ `PROFILE_NOT_DECLARED`）。
- **幂等重放**：同键第二次答 `replayed:true` 且派发目录数不变；`software.evidence` 读回与在盘序列一致；证据目录敏感串扫描 **0 命中**（`p3-evidence-audit.txt`）。

**提示词面回归（成套切代的受影响证据）**：0.10.1 + 1.4.1 上重跑 3.1 的字段电池 8 格，图哈希 / prompt 字符数 / `contextSkills` / `tierNotice` 与 3.1 读数**逐字相同**——contracts 1.4.1 的「v1.2 锁 scenario 字段兼容」被实测覆盖（`p2-smoke-fields-rerun.json` 对照 3.1 轮 `p5-fields-final.json`）。

**能力地板（conform 1.4.1）**：`union=6f0a1ec09978 items=27 pass=21 declaredAbsent=6 unverified=0 remediationMissing=0`（`conformDigest=c61212f58a7a`）；并集由 3.1 的 `75a89e670df7` 移动（mysql-cli@1.0.2 的 requiredProfiles 收敛 + requiredBy 随指针更新），**27 项 verdict 逐一未变**；`--union-out` 字节 sha256 复算一致。换绑没有凭空造出任何一格能力，也没有让哪一格变绿。

**一处实测驱动的声明修正**：gateway config 刻意**不带 `platform` 键**——连接器把 `config.platform` 读成 **OS 配方选择器**（`connector.py:152-153`：缺省才回落 OS 名）并找 `recipes/<该值>.json`；带着 `workbuddy` 时六件本体全部核验失败 `unverifiable / no-recipe-for-platform`（`p2-connector-health-preedit.json`），去掉后落到 `recipes/windows.json` 三件转可派发。教训：同一个词「platform」在栈里有两个语义（平台 id vs OS 配方选择器），本轮以读数定了本平台的键形并写进文件 note。

**未声明面（不写成已具备）**：`credentialProvider` 未提供 ⇒ mysql 的 query/dump 只能到结构化拒绝（补齐：用户在凭据管理器建 `reference:db-credentials` + 平台声明 provider，约 45 分钟）；session 三 provider 未提供 ⇒ desktop-session 只能到 `INTERACTIVE_REQUIRED`/`PROFILE_NOT_DECLARED`（补齐约 90 分钟，真起 GUI 需逐次授权）；`allowGuiLaunch=false` ⇒ 不代起 GUI；burp-suite 的 MCP/HTTP 转发未实测（共享侧 1.0.1 指针翻转是 qoder P8 留给用户的授权项）。以上全部登记于 `capabilities.unverified` 与 gapPlan 体系。

**本轮如实登记的环境事实**：P1 复算后、冒烟首跑时，`wf-runner 0.10.1` 释放目录内出现外来瞬态文件（7 格 `HASH_MISMATCH: Runner source package is incomplete`），数分钟后自行消失、目录复算 27/27 全绿；同窗口 `repo-lint 0.5.2` 目录内出现过又消失了一个 git 忽略的 `__pycache__/*.pyc`（未入封条，35 个封内文件全程 MATCH ⇒ 发布字节无漂移）。本机有他会话在活动，两处均登记不处置、本平台未动共享仓任何字节（D-91 教训：不动已封存释放目录内的东西）。

**已入仓（2026-09-25，P7）**：接入件提交至 `main`，提交 `eba6b9d1`（全哈希 `eba6b9d1a2b3237198301de0b7f4cda693489be5`；父提交 `7a2d65a3` = qoder 3.2.0 收口提交）。`git show --name-only` 共 **6 件，全部在 `workbuddy/bridge/` 内**（`workbuddy-config.json`、`bridge.json`、`capabilities.json`、`invocation-exceptions.json`、`software-gateway-config.json`、`platform.md`），非本目录路径 **0 条**；提交后本平台工作树干净、索引无差异。**远端读数如实**：`git ls-remote origin` 本机取不到（代理 502），未推送。**自指说明**：本段由紧随其后的第二次提交落盘（提交哈希写不进它自己的内容里），与 3.0/3.1 轮同一结构性处置。

**边界与未做**：不跑全矩阵（BP-3）；`conform --only <softwareId>` 不可执行（**D-92**：判定项族没有按软件的行，本轮以直驱电池 + `--only software` 矩阵代替，方案措辞留待下一代修正）；不翻共享指针（burp-suite 1.0.1 指针 plan 是 qoder 留给用户的授权项）；不写共享三仓；不代他平台申报。

## 与 §9 接口逐项对照

| §9 项 | workbuddy 状态 |
|---|---|
| `platform` / `platformRoot` / `toolRoot` / `agentRoot` / `runsRoot` | ✅ `bridge/workbuddy-config.json`；共享仓库只读，产物只落 `../runtime/` |
| `runner` / `contracts` 显式版本路径 | ✅ `0.10.0` / `1.4.0`（3.1 代际；`scannerRelease = repo-lint 0.5.1` 三件成套，见 `workbuddy-config.json`） |
| `bridge` / `capabilities` | ✅ `bridge/bridge.json`（§9 要求字段齐备）+ [capabilities.json](capabilities.json) |
| `capabilities.checks` 全为真 | ✅ 9 项，均本会话实证（导入自测 / 写探针 / 注册表只读 / 协议闭环） |
| `capabilities.profiles` | ✅ 已声明 `renderer = {adapters: [matplotlib-adapter-first], requires: [matplotlib]}`，venv 内 matplotlib 3.9.4/Agg 真实出图（`../runtime/renderer-selftest/render.png`，35938 字节） |
| `permissionAdapters` | ✅ 声明业务三元组；evidence 按 doubao 分面口径如实写明「prompt 阶段=会话自律，脚本阶段=无隔离沙箱不可执行」 |
| `scriptEnvironment` / 环境清单 | ⛔ **未提供脚本隔离沙箱**（无 WSL/容器隔离）。`environmentManifest` 钉主机侧解释器环境（20 包逐版本），供解析器校验 requires；协议内 `action:script` 阶段与 `--tool render-figure/record-visual-review` 不可执行；矩阵 claim+stop 不依赖脚本阶段 |
| `peerDispatch` / 派发器 | ⛔ 未声明、未提供 → 委派不可用；`false` 不进 `checks` |
| 传输面（CLI 或 MCP 至少其一） | ✅ CLI（PowerShell 执行 runner `cli.py`；本机 bash 不可用）+ **用户级 Skill `/wf` `/wfa`（A2）**；MCP 未注册 → 不声明 |
| 布局 `runsRoot/<run-id>/` | ✅ `run-lock.json`、`state.json`、`events.jsonl`、`commits/`、`transactions/`、`evidence/` |

## 已实证 / 明确不可用

**已实证**：
- **矩阵**：r3 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`（方式见上）；`check_follow` 零漂移（40 行全部从共享 current 解析，`../runtime/check-follow-result.json`）。
- **真实提交闭环**：`game-sprint-plan 2.1.1` intake/capacity/plan 三阶段连续 `completed` → `stop`（`../runtime/runs/workbuddy-submit-smoke-20260916/`，run-lock 钉 `platform=workbuddy`）。
- **专家调用**：`agent:novel-writer@1.4.0` 经 tool-lock 解析 `expert-task`，INTAKE prompt 含专家上下文 → `stop`（`../runtime/runs/workbuddy-agent-smoke-20260916-r2/`）。
- **并发独立性（C1/C2）**：`workbuddy-cc-a-20260916`（game-sprint-plan）与 `workbuddy-cc-b-20260916`（game-brainstorm 2.2.0）交错并行 `prepare→next→stop` 六步全 ok、两 run 同时活跃互不影响（`../runtime/logs/s7-cc-report.json`；规范 §10 的 workbuddy 实测）。
- **换代跟随**：`check_follow` 零漂移 + 五步演练留痕（`../runtime/maintenance/generation-follow-drill-20260916.md`）——用户一句话切默认的协议可执行。
- **入口**：`/wf` `/wfa` 已装入用户级技能面 `<local-user-path> `../skills/`），新会话起可用。

**不可用 / 未实测**：peer 委派（未声明）；协议内 `action:script` 阶段与图表工具一格执行（无隔离环境）；`process` 门禁未实测（唯一带该门禁的 repo-lint 在 prepare 即被拒）；崩溃恢复未做；同一 run 并发写守卫、C5 同项目串行未单独实测（以规范 §10 结论表为唯一权威）。

**数模档位**：遵守全平台同一档位（规范 §3.1）：未写档位 = **草稿**。**本平台不承接求解器链**（无脚本隔离环境），交稿级转 zcode。

## 入口

| 用法 | 形态 | 状态 |
|---|---|---|
| `/wf` `/wfa` 用户级 Skill（A2） | `<local-user-path> | ✅ 已装载（新会话起可用；config 未就绪时会提示先完成 S1–S5——现已全部完成） |
| runner 直调（A4） | `python -B cli.py --config bridge/workbuddy-config.json --request …` | ✅ 可用（平台 venv 解释器 + `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` / `PYTHONDONTWRITEBYTECODE=1`；PowerShell） |
| MCP 工具面（A3） | 未注册工作流服务 | 不支持（未声明） |

调用手册：[invocation-manual.md](invocation-manual.md)。实施方案：[integration-plan.md](integration-plan.md)。引擎配置：[workbuddy-config.json](workbuddy-config.json)。环境清单：[environment.json](environment.json)。能力：[capabilities.json](capabilities.json)。例外清单：[invocation-exceptions.json](invocation-exceptions.json)。

## 待办

| # | 事项 |
|---|---|
| W1 | 脚本隔离环境未提供（与 doubao 同边界）：若未来需要承接 repo-lint 或数模求解器链，需单独授权建沙箱（参考 qoder WSL2 jail）——`repo-lint` 的"只读共享根"候选翻正路径同 integration-plan §0 |
| W2 | 协议守卫（幂等回放、过期修订、同一 run 并发写、C5 同项目串行）未逐项单独实测；以规范 §10 结论表为唯一权威 |
| W3 | ~~整版单条命令矩阵在本会话沙箱下不可行（子进程总量限制）：后续复验沿用分片方式并更新 provenance，或在具备更长会话预算的环境整版重跑~~ **已闭合（2026-09-23）**：3.1.0 采纳轮把 **48 格整版矩阵一条命令跑完**（18 分钟，无分片、无机械合并，`../runtime/maintenance/3.1-adopt/baseline/p3-matrix.json`），2.x 时代的分片+机械合并做法**不必再沿用**。留档口径不变：分片做法与 r3 那份 40 行报告仍作为历史证据保留。 |

## 明确不做

不改 `tool/`、`agent/` 任何发布内容与共享 `current.json`（除非用户对某次换代显式发话并按 manual §4 留痕）；不改其他平台目录（含 zcode 的 ops 脚本，只读执行）；不 fork 共享契约进平台目录；不把未验证能力写成已具备（`checks` 只增实证项，负面能力一律进 `declaredAbsent`/`unverified`）；不伪造门禁证据；不把草稿写成已冻结。
