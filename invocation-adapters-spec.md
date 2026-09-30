# 调用适配规范（v0.2）

> 当前主方案以 `E:\ai\agentic-workflow-master-manual.md` 为准。2026-09-07 的早期实施总账与技术设计底稿已随 Phase 0–4 完成而作废，2026-09-30 摘除其 inbox 路径引用；历史脉络见 `versions/更新日志.md`。
> 早期 “Phase 1 已完成并停止” 仅是切换前基线。现行入口与接入矩阵见第 2 节；总状态见总手册、`E:\ai\HANDOFF.md` 与 `E:\ai\post-competition-closeout.md`。
> **〔历史快照：2026-09-17 接入面；现行状态读 versions/平台接入清单.md §8.29/§8.30〕** 接入（2026-09-17）：五个平台已接入（`codex` / `zcode` / `qoder` / `doubao` / `workbuddy`），矩阵均为 38 PASS / 2 EXPECTED / 0 FAIL；`dsh` 未接入。zcode 于 2026-09-17 重建，**不继承**重建前的脚本沙箱、peer、MCP、数模九阶段。下面 v0.3–v0.8 是按日期追加的历史注记，其中“Doubao 不视为运行平台”“Qoder 待验证”等**已被后续增补取代**，不要当现行状态。
> v0.3 增补（2026-09-07，zcode 会话）：**ZCode 已接入**（见 2.2）；**当时** Doubao 不视为运行平台（见 2.3，已被 v0.7 取代）；runner 候选至 **0.5.0**。总框架见 `HANDOFF.md`。
> v0.4 增补（2026-09-13，qoder 会话）：**Qoder 登记为待验证接入区**（见 2.4，非第 5 运行平台）；**repo-lint 0.1.2** 候选发布——只把 runtime 三处 platform 枚举加入 `qoder`，`current` 仍 0.1.1；剩余验证项见 T6。
> v0.5 增补（2026-09-15，qoder 会话）：**Qoder 按 §9 八项接口接入完成**（见 2.4）——钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`，声明 `permissionAdapters`（有意不声明 `profiles`），矩阵 `35 PASS / 5 EXPECTED / FAIL 0`。跑 `ops\invocation_matrix.py` 需带 `PYTHONUTF8=1`（详见 2.4 启动器环境）。
> v0.6 增补（2026-09-15，qoder 会话）：**Qoder 升为第 5 运行平台**（见 2.4）——矩阵第五轮（补脚本环境 + `profiles.renderer`，密封环境再按 120s 哈希预算定稿）`38 PASS / 2 EXPECTED / 0 FAIL`（r4/r5 同数），例外收敛为 `wf-runner`（设计）与 `repo-lint`（策略不可兑现，转为共享侧接口问题上报）；自建 WSL2 Ubuntu2204 钉版脚本环境（逐文件快照 + jail 内真实出图自测），`/wf` `/wfa` 已装进 Qoder 用户级技能面并在会话内装载验证。
> v0.7 增补（2026-09-16，doubao 会话）：**Doubao 升为第 6 运行平台**（见 2.5）——按 §9 八项接口接入，矩阵 r1 `38 PASS / 2 EXPECTED / 0 FAIL`（`doubao/runtime/matrix-smoke/doubao-matrix-20260916-r1.json`），钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`（契约枚举已含 `doubao`，无需发版），平台自建 Windows venv（`doubao/runtime/py-env`）+ 声明 `permissionAdapters`（业务三元组）与 `profiles.renderer`（matplotlib 3.9.4 平台内出图实测）；真实提交闭环、专家经 tool-lock 调用、C1/C2 并发均实测；**无脚本隔离环境**（script 阶段与图表工具不可执行、peer 委派未声明不可用）。
> v0.8 增补（2026-09-16，workbuddy 会话）：**WorkBuddy 完成接入并升为第 7 运行平台**（见 2.6）——应用户四条硬性要求（统一 `/wf` `/wfa`、架构只出接口、一句话换代跟随、独立可并行并点明限制）制定方案后当日执行：钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`，平台自建 Windows venv（python 3.9.13，20 包）+ 声明 `permissionAdapters`（业务三元组）与 `profiles.renderer`（matplotlib 3.9.4 平台内出图实测）；工作流与专家双闭环、C1/C2 并行、check_follow 零漂移、`/wf` `/wfa` 装入用户级技能面均实测；矩阵 r3 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`（因会话沙箱子进程总量限制按 `--only` 分 38 片执行后机械合并，provenance 留档）；无脚本隔离环境（script 阶段与图表工具不可执行、peer 委派未声明不可用）。

## 1. 范围与能力模型

目标是用平台实际支持的入口消费相同版本与执行协议，不要求所有平台有相同符号或插件系统。

**上位原则**：本文全部判据从属于 `versions/架构基本原则.md` 的 **BP-1 ~ BP-5**（三仓骨架不可变 / 平台对等与能力地板 / 验收与接入最小量 / 跨平台同一项目语义 / 分步实施与完成判定）。本文与 BP 冲突处以 BP 为准并回改本文。要点落点：入口形态可以不同，**能力天花板必须唯一**（BP-2）——差异只能是达标时间差，不得写成分层；本文 §6/§9 的验收步骤受 BP-3 最小量约束，本文 §8 的批次执行节奏受 BP-5 分步实施与完成判定约束；本文 §10 的并发结论必须扩展到跨平台口径（BP-4）。

| 原型 | 形态 | 必须验证的能力 |
|---|---|---|
| A1 | 自定义命令或 prompt，如 /wf | 注册、参数传递和执行接口 |
| A2 | 本地插件或 Skill，可能使用 $ | 具体客户端的发现、格式与参数机制 |
| A3 | MCP 工具 | 传输、握手、工具暴露与会话交接 |
| A4 | 自然语言手册加 CLI | 读文件、执行命令及 prompt 结果提交 |

四类能力独立判断。插件不自动包含 A1/A3，$ 不普遍等于插件。平台缺命令执行/MCP 时标 unsupported，A4 不是无条件兜底。原用户报告的客户端行为与本次文件检查结论分开记录。

## 2. 当前入口与接入矩阵

| 平台 | 已有证据 | 赛后动作 |
|---|---|---|
| Codex | E:\ai\codex\bridge\bridge.json、server.mjs、launch.cmd；本地数模两个 Skill | 首试；复用版本解析/锁记录，增加启动器与阶段交接 |
| DSH | E:\ai\dsh\bridge\bridge.json，7 份历史 run-lock；旧资料提到 /send-agent | 用户此前因成本暂缓，命令注册/插件加载待复核 |
| WorkBuddy（**第 7 运行平台；2026-09-16 升格**） | `E:\ai\workbuddy\bridge\workbuddy-config.json`（runner **0.6.0**、contracts **repo-lint 0.2.1** 显式选版、`environmentManifest` = `bridge\environment.json` 钉平台 venv）+ `bridge\capabilities.json`（`permissionAdapters` + `profiles.renderer`）+ `bridge\invocation-exceptions.json`；入口 = 用户级 Skill `/wf` `/wfa`（A2，`<local-user-path> CLI 直调（A4，PowerShell；本机 bash 不可用） | 矩阵 r3 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / FAIL 0`（`workbuddy\runtime\matrix-smoke\workbuddy-matrix-20260916-r3.json`；因会话沙箱子进程总量限制按 `--only` 分 38 片执行后机械合并，provenance 与整版尝试 r1@20/r2@24 留档）；工作流/专家双闭环、C1/C2 并行、check_follow 零漂移、换代五步演练均实测；doctor ok:true。**无脚本隔离环境**：script 阶段与图表工具不可执行；peer 委派不可用；数模求解器链不承接。**不要默认转到 zcode 交稿**——zcode 2026-09-17 起同样未验证求解链 |
| ZCode（**2026-09-17 重建后仍已接入**） | `E:\ai\zcode\bridge.json` + `bridge\zcode-config.json`（runner **0.6.0**、contracts **repo-lint 0.2.1**）+ 用户级 `/wf` `/wfa` `/math`；Python `zcode/runtime/py-env`。详见 2.2 与 `zcode/bridge/platform.md` | 现行矩阵 `38 PASS / 2 EXPECTED / FAIL 0`（`zcode/runtime/matrix-smoke/reconnect-final.json`）。**未重建**：scriptEnvironment、peerDispatch、MCP、数模求解/冻结链。9-07/9-13 的冒烟与 G3 证据已删除，不得当现行能力 |
| Qoder（**第 5 运行平台；2026-09-15 升格**） | `E:\ai\qoder\bridge.json` + `bridge\qoder-config.json`（runner **0.6.0**、contracts **repo-lint 0.2.1** 显式选版，另加 `scriptEnvironment` = 本平台 WSL2 钉版 venv 与逐文件 `environmentManifest`）+ `capabilities.json`（`permissionAdapters` + `profiles.renderer`）+ `bridge\invocation-exceptions.json` + 本平台 runtime；入口 `~/.qoder/skills/{wf,wfa}`（源码在 `qoder\plugins\ai-workflow-hub\`）。矩阵 r5 `38 PASS / 2 EXPECTED / FAIL 0`（`qoder\runtime\matrix-smoke\`，r4 同数），`ops\doctor.py --platform qoder` = `ok:true` 零 blockers；`prepare → next → submit → stop`、幂等·修订·并发守卫、换代跟随、jail 内真实渲染均实测 | 剩余：协议内 `action: script` 阶段与 figure 工具的一格执行、`process` 门禁、崩溃恢复、A3 MCP 注册；~~peer 委派不可用（见 2.4 上报 ③）~~；`repo-lint` 策略不可兑现（上报 ⑤）。**〔2026-09-18 更正，本行的 0.6.0/矩阵 r5 是 2.0 前快照〕** qoder 生产现钉 **wf-runner 0.7.7** + `contracts=runtime-contracts/1.1.0` + `scannerRelease=repo-lint/0.3.0` + `executionBackend` + `projectWriteRoots` + peer 两键（矩阵 `38 PASS / 0 NEEDS-INPUT / EXPECTED 0 / FAIL 1` 系 **0.7.6 面**实测，唯一 FAIL=`repo-lint@0.2.1` 格）；**peer 委派已声明并实证**——0.7.6 上进程内、**0.7.7 起在协议 wire 上**（见 2.4 上报 ③ 的 0.7.7 状态标记），故该格不再是"不可用"；剩余未实测项以 `qoder/bridge/platform.md` 的 `unverified` 为准 |
| Doubao（**第 6 运行平台；2026-09-16 升格**） | `E:\ai\doubao\bridge.json` + `bridge\doubao-config.json`（runner **0.6.0**、contracts **repo-lint 0.2.1** 显式选版；`environmentManifest` = `bridge\environment.json` 钉平台 venv）+ `bridge\capabilities.json`（`permissionAdapters` + `profiles.renderer`）+ `bridge\invocation-exceptions.json`；入口 = CLI 直调（A4，会话 Bash/Python 执行 `cli.py`），无客户端命令/技能注册 | 矩阵 r1 `38 PASS / 2 EXPECTED / FAIL 0`（`doubao\runtime\matrix-smoke\`）；`prepare → next → submit → stop` 真实闭环（game-sprint-plan 三阶段）、agent 经 tool-lock（novel-writer）、C1/C2 并发实测、共享默认跟随零漂移均实测。**无脚本隔离环境**：script 阶段与图表工具不可执行；peer 委派不可用；数模求解器链不承接。交稿级须先确认目标平台已声明并验证 `math-solver-chain`（zcode 重建后当前未声明） |

Codex 已有本地入口位于 E:\ai\codex\chatgpt\userdata\codex-home\skills\：

- math-modeling-programmer/SKILL.md 调用 ai_run_workflow，显式工作流 1.5.0。
- math-modeling-agent/SKILL.md 调用 ai_run_agent，显式专家 1.6.0、工作流 1.5.0。
- bridge 创建 run-lock v1，返回 model-orchestrated 计划；当前会话仍负责执行。prepared 不是成功。

以上是文件层面的协议，当前客户端是否已加载工具要在实际会话核实。赛前保留既有固定版本参数，不按新模板要求重生成。

### 2.1 Codex Phase 1 现行入口

现行 bridge 保留 ai_run_workflow/ai_run_agent：数模新调用分别显式固定工作流 1.6.0、专家 1.7.0；专家内部服从精确 tool-lock。既有显式旧版本继续使用旧计划接口。共享数模 current 不变，Codex 本地默认与两个 Skill 使用新版本。

新增 ai_runner_request（prepare/next/submit/status/stop）、ai_runner_execute（已领取的隔离脚本及允许的图表工具）、ai_runner_seal（不可变阶段证据）。写请求带持久幂等键与修订号；prompt 返回任务由当前会话实际完成，schema 和领域门禁通过后才能提交。run-lock、state、events 及证据均归 Codex runtime。

项目输入为 parameters 和 inputSources，真实字段与九阶段绑定见 `E:\ai\tool\math-modeling-programmer\versions\1.6.0\docs\stage-bindings.md`。用户授权的源项目不被回写，执行副本在新 run 的 work/project。需要可追溯规格、实际验证和视觉审查；合成验收不能替代比赛模型确认。

实际启动器为 `E:\ai\codex\bridge\runner_adapter.py`，从 bridge.json 固定 Python 与 runner-config.json。新进程及长驻配置开关实测通过。当前桌面旧 MCP 连接须重连后载入新工具；同一适配器支持标准输入 JSON，两个本地 Skill 已说明直接调用方法。未新增 MCP 服务条目或宣称其他平台可用。

### 2.2 ZCode 现行入口（2026-09-17 重建；以下取代 9-07/9-15 写法）

调用手册：`E:\ai\zcode\bridge\invocation-manual.md`。平台章：`E:\ai\zcode\bridge\platform.md`。引擎配置：`E:\ai\zcode\bridge\zcode-config.json`（platform=zcode、contracts=`repo-lint 0.2.1`、runner=`tool\wf-runner\versions\0.6.0`、Python=`zcode\runtime\py-env`、runs 只落 `zcode\runtime\runs\`）。

**入口**：用户级 `/wf`、`/wfa`、`/math`；工作区级 `.zcode` 已登记。直调用本平台 venv 执行 `cli.py --config E:/ai/zcode/bridge/zcode-config.json`。矩阵工具在 `zcode/bridge/ops/invocation_matrix.py`，**必须显式传 `--config`**，否则会误用其他平台配置。

**现行能力（`capabilities.json`，attestedAt 2026-09-17）**：python 运行时、prompt 领取/提交、stop、renderer 自测（非视觉验收）、矩阵 38/2/0。`declaredAbsent`：**scriptEnvironment、peerDispatch、mcp-tool-surface、math-solver-chain**。权限是会话约束，不是 OS 沙箱。

**不要再用的旧结论**：peer 派发已验收、WSL 脚本环境、math-venv、九阶段 FREEZE、工作区 `.venv`、路径 `zcode/workspaces/agentic-workflow-implementation/`。重建 notes 写明历史证据已删、不继承能力声明。数模按 `competition-runbook.md`：未写档位=草稿；交稿当前阻断。

本节由 zcode 会话维护；Codex 2.1 节不受影响。

### 2.3 Doubao（2026-09-07 探测 → 2026-09-16 第 6 运行平台）

历史探测（2026-09-07，Z4）：`Doubao.ini` 与 `DoubaoWork.ini` 当时为空（各 3 字节），`app\` 为纯安装目录，无 MCP/命令/插件配置面，故记**不视为运行平台**、不设 `bridge/platform.md`、不要求 bridge；复测条件当时定义为「ini 出现非空配置段」。证据：`zcode/runtime/runs/20260907-closeout-z01/reports/z4-doubao-probe.json`。

2026-09-16 接入（用户授权变更定位）：ini 文件仍为 3 字节纯文本 `app`（无配置段，客户端命令面依旧为空），但 Doubao 会话的 **agent 能力面**（Bash/Python/文件读写/技能）已满足 §9 传输面「CLI 至少其一」，故按 §9 八项接口完成接入并升格（详见 2.5）。此前的「ini 无配置段 → 不可接入」判定已不适用：接入判据是矩阵 FAIL 0，不是客户端配置面。

[正式入口验收](codex/runtime/runs/20260905-phase1-implementation-02/reports/default-integration.json) 与 [恢复记录](codex/runtime/runs/20260905-phase1-implementation-02/reports/activation-plan.json) 已保存。通用 doctor、模板生成和跨平台安装仍属于后续工作。

### 2.4 Qoder（**第 5 运行平台**；2026-09-13 落地，2026-09-15 换代、验收并升格）

调用手册：`E:\ai\qoder\bridge\invocation-manual.md`；平台章：`E:\ai\qoder\bridge\platform.md`；引擎配置：`E:\ai\qoder\bridge\qoder-config.json`（platform=qoder、runner=0.6.0 与 contracts=repo-lint 0.2.1 均显式选版、runs 只落 `qoder\runtime\runs\`）。

接入过程留有两份证据。先钉 contracts 0.1.1 试探：`prepare` 在协议校验阶段以 `'qoder' is not one of ['codex','dsh','workbuddy','zcode','doubao']` 拒绝且不建 run 目录（`qoder\runtime\probes\qoder-integration-probe-20260912\`）。经用户授权发布 **repo-lint 0.1.2**（新增版本目录，唯一改动是 runtime `protocol` / `run-lock` / `transaction` 三处 platform 枚举加入 `qoder`；发布前基线契约 56/56、单测 53/53，发布后经自身 lint 复检 `static-pass`、blocking 为空；`0.1.1` 逐哈希未变，`repo-lint/current.json` 仍 0.1.1）后，`prepare → next(claim intake prompt) → stop` 通过（`qoder\runtime\runs\qoder-integration-smoke-20260912-r2\`，失败尝试 `…-r1-blocked` 保留未删）。

能力边界（2026-09-15 升格时复核）：**已实测** `prepare → next → submit`（三阶段连续 `completed`）→ `stop`、阶段产物 schema 拒绝、同键换内容 `IDEMPOTENCY_CONFLICT`、同键同请求幂等回放（不重复执行）、过期修订 `REVISION_CONFLICT` 且事件链与 state 逐字节未变、同 run 并发写 `REVISION_CONFLICT`、共享默认换代后零配置跟随。**矩阵验收（当前判据）** `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`（当前判据 = 第五轮 `qoder\runtime\matrix-smoke\qoder-matrix-20260915-r5.json`，密封环境按 120s 哈希预算定稿 2401 文件后复跑；r4 为补脚本环境与 `profiles.renderer` 的那一轮，同数；r1/r2/r3 留档），`ops\doctor.py --platform qoder` 报 `ok:true` 零 blockers；两条例外按实测错误码登记在 `qoder\bridge\invocation-exceptions.json`（`wf-runner` 设计例外、`repo-lint` 策略不可兑现）。**脚本面**：本平台自建 WSL2 Ubuntu2204 钉版环境（`runtime\wsl-py-env` + 逐文件快照 `bridge\script-environment.json`），隔离控制器实测 `exitCode 0 / processTreeEnded true / landlockAbi 3`，jail 内 `/environment/bin/python` 用 matplotlib 3.10.9/Agg 真实出图（`qoder\runtime\jail-selftest\JAIL-NOTE.md`）；因此数模工作流与两专家不再因 renderer 被拒。**仍未实测**：协议内 `action: script` 阶段与 `--tool render-figure/record-visual-review` 的一格执行（前者全仓库只有 repo-lint 有、被其策略卡住；后者要求数模 run 已领取 FIGURES prompt）、`process` 类门禁（由主机解释器执行，不经 WSL）、崩溃恢复、peer 委派。**分面强制口径**：脚本阶段的 `network: deny` 与进程限制是内核级（`unshare --net` + Landlock，实测 jail 内无网、无 `/bin/sh`、看不见共享根）；prompt 阶段仍由会话执行，那一部分的 `network: deny` 只是自律——Qoder 具备网络与任意命令能力。数模范围按实测划界：**图 QA / 渲染 / PDF 审计链可承接**（发布脚本实际只 import matplotlib·numpy·PIL·fitz，四类均已在密封环境且 jail 内出图实测）；**求解器链不承接**——scipy/pandas/sklearn 等装进密封环境会超引擎的每次执行全量哈希预算（见上报 ⑥），且本平台从未跑过九阶段全链，交稿级要求一律转 zcode（比赛备份）。用户级配置与凭据在 `<local-user-path> `~/.qoder/skills/{wf,wfa}`），不迁入平台或共享仓库目录。

启动器硬性环境：`PYTHONIOENCODING=utf-8`（否则中文 prompt 按 cp936 落盘、UTF-8 读不回）与 `PYTHONDONTWRITEBYTECODE=1` + `-B`（否则向只读发布目录写 `__pycache__`，触发 `Runner source package is incomplete`）。

上报共享侧（除已单独授权的缓存清理外，本节不构成修改任何发布目录的授权）：① ~~`wf-runner` `resolution.py:139` 把锁内 repo-lint `version` 写死~~ —— **已结案（并修正归因）**：该字面量逐版核得**只存在于 `0.5.0`**（`resolution.py:137/139/140`），`0.5.2` 起即由解析键取版本，**不是 0.6.0 的改动**；qoder 实测钉 0.6.0 时锁内 `version=0.2.1` 与 `path`/`manifestSha256` 自洽；② 失败的 `prepare` 会在资源解析前 `mkdir`，残留无锁无状态的 run 目录，同 `runId` 重试即被拒（qoder 侧留证 `qoder-integration-smoke-20260912-r1-blocked`）；③ **`engine 0.6.0` 未实现 `delegate`**（`engine.py` 零命中）：未声明 `peerDispatch` 的平台在协议 v1.2 下发委派请求，会穿过三道守卫后不匹配任何操作支，产出缺 `delegation` 的 `ok:true` 响应并被契约响应规则拦成 CLI 回溯——**无事件、无副作用，但拿不到 `CAPABILITY_UNAVAILABLE` 这类机器可读拒绝码**，即"按平台声明拒绝"这一条在委派面上尚未闭环（证据 `qoder\runtime\probes\qoder-peer-dispatch-20260915\PROBE-NOTE.md`）；④ **两类错误出口不一致**：引擎自抛的 `Rejected` 有规范信封（如终态 run 二次 `stop` → `TERMINAL_RUN`），而契约 schema 拦下的违规（`status` 带 `idempotencyKey`、未知 `operation`、`status` payload 非空、`expectedStateRevision: null`）只以原始 `jsonschema` 回溯 + 空 stdout + `exit 1` 出口，建议统一包成 `INVALID_REQUEST` / `CONTRACT_VIOLATION`，否则自动化只能靠 stderr 文本判别；⑤ **`repo-lint` 声明的 `filesystem=shared-read-only-platform-report-write` 在现行隔离控制器下任何平台都无法兑现**——控制器只 bind `release / environment / work / scratch`，本平台 jail 自测直接测到共享根在 jail 内不可见（`seesEaiRoot=false`），zcode 也只声明业务三元组、同样调不动它。要么改工作流策略、要么给控制器加"共享根只读挂载"档，**不应由各平台谎报适配器凑绿**（证据 `qoder\runtime\jail-selftest\JAIL-NOTE.md`）；⑥ **`environment_guard.verify_script` 每次脚本执行都全量重算密封清单的哈希、超时写死 120s**，等于给"钉版脚本环境"的大小加了硬上限：本平台实测 **2401 文件 ≈52s 可用 / 7108 文件（含 scipy·pandas·sklearn·statsmodels·sympy）≈157s 直接超时**，且失败码是 `HASH_MISMATCH: Script environment content changed or verification unavailable`——把"超时"报成"环境被篡改"，排错方向会被带偏。建议改子树摘要或按包摘要（`RECORD` 已具备），并把超时与哈希不符分成两个错误码。**本平台据此只能把求解器类库排除在密封环境之外**，即数模在 qoder 只承接图 QA/渲染/PDF 审计链。另：`qoder` 会话 2026-09-13 经单独授权清除了 `wf-runner\versions\0.5.0\__pycache__\` 内 6 个非清单内 `.pyc`（mtime 2026-09-08/09-10，早于本轮）——这类生成缓存会让钉 0.5.0 的任何平台在解析阶段直接被 `Runner source package is incomplete` 拒绝，发布后冒烟须常驻 `PYTHONDONTWRITEBYTECODE=1`。证据 `qoder\runtime\maintenance\wf-runner-0.5.0-pycache-evidence.json`。**〔0.7.7 后状态标记（2026-09-18，不改写上文原述）〕** ③ **已闭**：`delegate` 现为协议上的真操作（`payload={peer, stageId, request}`，回答契约的 `result.delegation` 封闭成员），未声明 `peerDispatch` 的平台拿到机器可读的 `CAPABILITY_UNAVAILABLE`。⑥ 两处订正：`120 s` 不是"写死"也不是硬上限，而是平台在后端里自声明的 `verifyTimeoutSeconds`（引擎按 1..3600 校验），0.7.7 起超时报 `ENVIRONMENT_VERIFY_TIMEOUT`、`HASH_MISMATCH` 只留给真实内容变化——**剩"全量→子树/按包摘要"未做**，故末句"只承接图 QA/渲染/PDF 审计链"应读作**成本选择**而不是接口边界。账见 `versions/架构2.0.0.md` §8 与 `qoder/runtime/maintenance/2.0-D/baseline/W-framework*.json`。

### 2.5 Doubao（**第 6 运行平台**；2026-09-16 接入、验收并升格）

调用手册：`E:\ai\doubao\bridge\invocation-manual.md`；平台章：`E:\ai\doubao\bridge\platform.md`；引擎配置：`E:\ai\doubao\bridge\doubao-config.json`（platform=doubao、runner=0.6.0 与 contracts=repo-lint 0.2.1 均显式选版、`environmentManifest` = `bridge\environment.json`、runs 只落 `doubao\runtime\runs\`）。

接入要点：契约 platform 枚举（repo-lint 0.2.1 的 protocol / run-lock / transaction 三处 schema）**已含 `doubao`**（2026-09-16 逐文件核对），无需像 qoder 当年那样发契约新版本。平台自建 **Windows venv**（`doubao\runtime\py-env`，python 3.9.13）：runner requirements.lock 8 库逐版本匹配 + matplotlib 3.9.4 / numpy 1.26.x（renderer profile 需要），`environment.json` 逐包钉版（20 包）。

能力边界（2026-09-16 接入时实测）：**矩阵 r1 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`，退出码 0**（`doubao\runtime\matrix-smoke\doubao-matrix-20260916-r1.json`）——40 行全部从共享 `current` 解析、零漂移（`doubao\runtime\check_follow.py`），即「一句话切默认」后本平台零配置跟随。**真实提交闭环**：`prepare → next → submit`（`game-sprint-plan 2.1.1` 的 intake / capacity / plan 三阶段连续 `completed`）→ `stop`，`run-lock` 钉 `platform=doubao`（`doubao\runtime\runs\doubao-submit-smoke-20260916\`）。**专家调用**：`agent:novel-writer@1.4.0` 经 tool-lock 解析主工作流 `expert-task` 后 `prepare → next(prompt) → stop` 全 ok（`doubao-agent-smoke-20260916`）。**并发独立性（C1/C2）**：`game-sprint-plan` 与 `game-brainstorm` 两 run 并行 `prepare → next → stop` 均 ok、互不影响。**渲染自证**：venv 内 matplotlib Agg 真实出图（`doubao\runtime\renderer-selftest\render.png`）。`ops\doctor.py --platform doubao` 报 `ok:true` 零 blockers（doctor 平台登记随接入更新）。

**边界如实说明**：① **无脚本隔离环境**——`action: script` 阶段与 `--tool render-figure / record-visual-review` 不可执行；`permissionAdapters` 只声明业务三元组，`repo-lint` 与 `wf-runner` 两资源按例外清单登记 EXPECTED（与 zcode/qoder 例外面一致）；② **peer 委派不可用**（未声明 `peerDispatch`，无派发器）；③ 协议守卫（幂等回放、过期修订、同 run 并发写、C5 同项目串行）未逐项单独实测，以规范 §10 结论表为唯一权威；④ **数模**：可 prepare/claim prompt，但脚本阶段不可执行 → **求解器链不承接**；交稿级须先确认目标平台已声明并验证 `math-solver-chain`（**不要默认转 zcode**，zcode 2026-09-17 起该项为 `declaredAbsent`）；⑤ 客户端命令面依旧为空（`Doubao.ini` / `DoubaoWork.ini` 各 3 字节纯文本 `app`），入口 = CLI 直调（A4 传输面）。

### 2.6 WorkBuddy（**第 7 运行平台**；2026-09-16 方案定稿并当日执行、验收升格）

实施方案：`E:\ai\workbuddy\bridge\integration-plan.md`（S1–S8，已全部执行）；调用手册：`E:\ai\workbuddy\bridge\invocation-manual.md`；平台章：`E:\ai\workbuddy\bridge\platform.md`。本节由 workbuddy 会话维护。

制定背景：用户对 WorkBuddy 接入提出四条硬性要求——①所有 tool 走 `/wf`、所有 agent 走 `/wfa` 且格式一致；②架构只提供接口、不担心平台接入；③tool/agent 更新后在平台内一句话即可切换默认版本；④tool/agent 相互独立可并行、不能并行的在说明书点明。四条与共享现状（§8 统一语法、§9 声明式接口、共享 `current.json` + 平台零配置跟随、§10 并发结论表）逐一对照后均在平台侧满足，未改共享框架；对照表见 integration-plan §0，落点见 invocation-manual §2/§4/§5。

**已实测（2026-09-16）**：钉版 `wf-runner 0.6.0` + `repo-lint 0.2.1`；平台 venv（python 3.9.13，requirements.lock 8 库逐版本匹配 + matplotlib 3.9.4/numpy 1.26.4，20/20 导入自测）；`profiles.renderer`（Agg 真实出图）；`permissionAdapters` 业务三元组；**矩阵 r3 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / FAIL 0`（40 行）**——因 WorkBuddy 会话沙箱对单条命令的子进程总量限制，整版运行两次被终止（r1@20、r2@24，直调同一资源均成功），按 `--only` 分 38 片执行后机械合并，每片均为规范矩阵输出、provenance 随报告留档；工作流闭环（game-sprint-plan 2.1.1 三阶段 `completed`→`stopped`）与专家闭环（novel-writer@1.4.0 经 tool-lock 解析 expert-task，prompt 含专家上下文）；C1/C2 交错并行六步全 ok；`check_follow` 零漂移；换代跟随五步演练（安全路径）留痕；`doctor.py --platform workbuddy` = ok:true 零 blockers；`/wf` `/wfa` 已装入用户级技能面（`<local-user-path>

**能力边界**：无脚本隔离环境（不做 WSL/容器沙箱）→ 协议内 `action:script` 阶段与 `--tool render-figure/record-visual-review` 不可执行；`peerDispatch` 不声明 → 委派不可用；MCP 未注册；数模求解器链不承接。交稿级须先确认目标平台已声明并验证 `math-solver-chain`（**不要默认转 zcode**）。**候选翻正项**：`repo-lint` 的 `shared-read-only-platform-report-write` 若实测出"共享根只读 + 写域限平台"可行则可声明，未实测前保持 EXPECTED。**执行注意**：PowerShell（bash 不可用）；`PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`/`PYTHONDONTWRITEBYTECODE=1`；`expert-task` 的 inputSchema 要求 `objective`（≥20 字符）。

## 3. 统一协议与后续适配

1. 对外语义为直调工作流、专家加工作流；可采用 /wf、/wfa，但不把名称视为各平台已注册命令。
2. 结构化传递 id、可选显式版本、任务输入、项目授权范围；使用实际平台参数机制，不假设全部支持 $ARGUMENTS。
3. 顶层专家：显式版本 → 本平台默认覆盖 → current；工作流直调：显式版本 → current。专家内资源必须服从精确 tool-lock，显式参数不能绕过。
4. 运行前固定完整依赖及来源/哈希。新模板不硬编码默认发布版本，但允许冻结、回归或用户显式选版；验收不能 grep“没有任何版本号”。
5. 平台启动器解析 runner current、核验后调用 versions/<version>/ 内真实入口。不能调用根级 run.py 或 scripts/mcp_server.py，配置中的根路径不是程序。
6. prepare/next/submit/status/stop 采用同一执行语义。prompt 返回任务进入 waiting-for-input，当前会话执行并提交，验证后推进；独立 CLI 不自动注入系统提示词。
7. 失败报告 runId（若已创建）、阶段、原因与证据；缺必需门禁为 BLOCKED，未知动作/越权/未锁定 peer 拒绝。适配器不得绕过失败继续交付。
8. 档位口径（§3.1）对直调与专家模式、对**全部工作流**同样生效（2026-09-22 起不再点名数模）；未写档位不得按其流程声明的完整阶段数或 runner INIT 执行。
9. **协议交付固定 UTF-8（2026-09-19 2.0-X 轮入规，D-15/D-16）**：CLI 入口在 stdout 上写出的**恰一份**协议文档必须是 **UTF-8 字节**，不随宿主控制台代码页变化；平台启动器也应按 UTF-8 解码。此前 `print(json.dumps(..., ensure_ascii=False))` 在 Windows ANSI 代码页（本机 cp936）下遇到提示词里的星平面字符（emoji）就在引擎内部抛 `UnicodeEncodeError`，**响应永远送不出去**，与平台能力无关。**分类规约**：请求/评审载荷不合 schema 才是 `INVALID_REQUEST`/`phase:"request"`（调用方可纠正）；响应**交付**失败是引擎自身故障，必须出 `INTERNAL_ERROR` + `phase:"internal"` + `outcome:"unknown"` + `diagnosticRef`——因为此刻事务可能已提交，把它报成"你的入参不合"会把调用方支去改一个本来就对的请求（真事形态：run 已 `prompt-delivered`、`stateRevision` 已进 2，后续操作只撞 `REVISION_CONFLICT`）。`outcome:"unknown"` 的处置约定是**回读 `status` 对账**，不是重发同一请求。

### 3.1 调用档位（全平台、全工作流通用）

> **2026-09-22 修订（用户裁决，见 `versions/架构基本原则.md` §9 第 11 条）**：本节原为「数模调用档位」，现**通用化**为对全部工作流生效的档位口径——未写 = 草稿、过图、交稿三档不变，引擎 `rigor` 字段与已发布字节不变。**数模不再有专属链路、专属环境或跨平台特例**：`math-solver-chain` 不再是各平台需声明的能力项，「交稿须转到某个特定平台」一类措辞自本日起作废（下文按日期追加的各平台表里那些句子保留为**当时的实测快照**，读作历史不读作规则）。所需解释器 / 库 / 外部程序按 BP-1 §1.6 三选一归属：装在 agent 里、装在 skill 里（只声明，真实字节不入仓）、装在所属 platform 的 `runtime/` 里。

适用于任何平台对 `math-modeling-programmer` 的直调或经 `math-modeling-programmer` 专家调用。不修改已发布工作流目录；由会话按用户声明选择范围。用户模板：

```text
档位：草稿 / 过图 / 交稿
项目：<路径>
范围：只做 Qx（或：只改图 / 只改代码）
求解器：不重跑
实验扫描：不做
```

| 档位 | 做 | 不做 |
|---|---|---|
| **草稿**（默认） | 只动点名的问 / 图 / 代码 | INIT 已有项目、重跑求解器、实验扫描、独立验证、严格 QA、视觉审查、FREEZE |
| **过图** | 草稿 + 出图 + 非严格 figure QA；明显挡数据或裁切才改 | 重跑求解器、FREEZE；WARN 不阻断 |
| **交稿** | 该问所需阶段；SPEC 须用户确认；严图 + 视觉审查 + FREEZE | 擅自 INIT 清空已有项目；覆盖原始数据或已冻结交付 |

红线：非交稿不得称为已验证或已冻结；原始数据与已冻结交付只读；已有项目禁止 INIT（会清空目录）。run-lock 记录实际做过的阶段，并注明跳过项。

落地：zcode 已写入 `/math`、数模 `/wfa` 与 `zcode/bridge/competition-runbook.md`；qoder 已写入 `qoder/bridge/platform.md` 与 `qoder/bridge/invocation-manual.md` §3（但科学栈未自证，本平台暂不承接数模业务）；doubao 已写入 `doubao/bridge/platform.md` 与 `doubao/bridge/invocation-manual.md`（无脚本隔离环境，数模求解器链不承接）。Codex / DSH / WorkBuddy 本地入口由**所属平台会话**改到服从本节（各章：`*/bridge/platform.md`）。本规范不授权改其他平台目录。

## 4. 平台组件与共享模板

共享模板随 E:\ai\tool\wf-runner\versions\<version>\docs\adapters\ 发布。平台渲染后的配置、插件、启动器属于本平台目录；格式必须按当前客户端资料与实际安装结构验证，不把一个平台的插件清单套到其他平台。

启动器职责：识别平台 → 读取配置/runner 指针 → 核验版本和路径 → 固定解释器与依赖 → 调用不可变入口 → 维持会话交接。通用 DAG/gate 只在共享版本实现，启动器不另建执行逻辑。增加一行 JSON 不足以完成这些职责。

Codex 首版优先复用已有 bridge，是否单独发布 wf-mcp-server 在试点后决定。配置、缓存、日志、输入及生成依赖属于本平台；新 runner 产物归本平台 runtime/runs。

## 5. 生成、自检与安装

doctor 能力探测与适配器生成曾实现于 `zcode\workspaces\agentic-workflow-implementation\ops\doctor.py`。**该工作区 2026-09-17 已不存在**；不要再按那条路径执行。各平台现行矩阵工具以本平台 `bridge/ops` 或当时实际配置为准（zcode：`zcode/bridge/ops/invocation_matrix.py`，必须显式 `--config`）。2026-09-13 对 codex / dsh / workbuddy / zcode / qoder 的 doctor 报告属于历史；**2026-09-16 doubao 接入后** `--platform doubao` 曾报 `ok:true`（备份 `doubao\runtime\maintenance\doctor.py.bak-20260916`）。zcode 重建后须重新核对本平台是否仍有 doctor 副本，不得假定仍可用。

流程：核实能力和配置位置 → 选择 A1–A4 → 本平台 staging 渲染 → 检查同名配置/命令 → 展示差异与所需权限 → 验证后安装。默认不覆盖既有文件，保存旧值、生成清单与恢复路径。

模板和 runner 版本进入记录。平台生成物可重生成，但不能无备份覆盖本地修改或自动删除。回滚恢复前一配置/启用状态并保留诊断证据；仅在 A4 前置能力已验证时，才可将手册作为备用入口。

## 6. 接入验收

**验收深度按 BP-3 分级，不再是固定仪式**：必留（便宜且高价值）= SHA256 完整性、版本入 run-lock、权限/Profile 声明命中、**受影响**矩阵格 FAIL 0。全矩阵与逐平台重认证只属于**首次平台接入**与**引擎/契约大版本升级**；新增或升级单个 tool / agent / software 配方只做 `--only <id>` 单格冒烟；逐字节回滚演练每引擎大版本一次（每次发布仍留逐字节备份 + sha256）。未变能力按内容哈希沿用既有 attestation，不重复认证。新增任何验收项先过三问：抓的是不是真失败 / 能不能增量 / 能不能并进同一条 `conform` 命令。

- 直调、专家模式分别验证；版本和来源正确，专家调用不能越过 tool-lock。
- prompt 实际完成返回任务与提交结果；script 产物和退出状态实际核验。
- 未知 id、缺输入、非法路径、跨平台写入、未知工具映射、缺必需 gate 均拒绝或阻断。
- 重复提交不重复执行，停止/超时留证，prepared 不冒充完成。
- 新 runner 发布时在途 run 固定旧版；新 run 的版本生效与长驻进程重载策略有记录。
- 显式旧版回归通过校验，但不绕过专家锁、不修改旧发布目录。
- 配置切换与回滚实际演练，不依赖未验证的手册兜底。

## 7. 待核实项与维护

| 编号 | 问题 | 完成条件 |
|---|---|---|
| T1 | DSH 命令注册与 bridge/plugins 加载 | 恢复使用后由所属平台复核源码/客户端并验证 |
| ~~T2~~ | **已结清（2026-09-16，WorkBuddy 接入）**：能力面结论 = 用户级 Skill（A2）+ PowerShell/文件 CLI（A4），MCP 不声明；接入判据达成（矩阵 r3 `38 PASS / 2 EXPECTED / 0 FAIL`，见 2.6） | 见 2.6 与 `workbuddy/bridge/platform.md` |
| T3 | Codex runner 启动与会话交接 | 复用既有 Skills/MCP 的 prepare/submit 闭环 |
| ~~T4~~ | **已结清（2026-09-07）**：ZCode 入口落地（bridge/config/插件包）+ 集成冒烟全绿；工作区级 `.zcode` 因一级目录白名单约束移除，命令/技能由插件包承载（待 UI 安装） | 见 2.2；剩余：用户 UI 安装插件（可选）、wf-mcp-server（A3 层，未来项） |
| ~~T5~~ | **已结清（2026-09-16，doubao 接入）**：2026-09-07 Z4 探测当时判定 Doubao 配置面为空 → unsupported；2026-09-16 用户授权变更定位，Doubao 会话以 agent 能力面（CLI 传输面）按 §9 八项接口接入并升格为第 6 运行平台（矩阵 `38 PASS / 2 EXPECTED / 0 FAIL`） | 见 2.3 / 2.5（z4-doubao-probe.json、doubao-matrix-20260916-r1.json） |
| T6 | Qoder 接入（qoder 会话）：**已结清并升格为第 5 运行平台（2026-09-15）**——§9 八项达成，矩阵 r5 `38 PASS / 2 EXPECTED / FAIL 0`（r4 同数），`permissionAdapters` + `profiles.renderer` 已声明，自建 WSL2 钉版脚本环境（jail 内真实渲染自测通过），`submit` + 幂等回放 + 过期修订 + 并发单写者 + 换代跟随实测，`/wf` `/wfa` 已装入用户级技能面并验证装载。**仍开放**：协议内 `action: script` 阶段与 figure 工具的一格执行、`process` 门禁、崩溃恢复、A3 MCP | 逐项实证后更新 `qoder/bridge/capabilities.json` 与例外清单；未验证项不得写成已具备 |

主方案决定顺序与冻结，架构规则决定隔离与不可变。本文不授权修改其他平台目录或提前实施；不能引用旧规范绕过主方案。

## 8. 可调用性判据（R1-1，2026-09-14 新增）

"可调用"是**可验证判据**，不是承诺：

- **工作流可调用**：`prepare(mode=workflow, version=current)` 成功 → `next` 返回合法 task（含 `stageId` / `attempt` / `action` / `inputSha256` / `artifacts` / `allowedTools`，且 prompt 或 script 与定义一致）→ `stop` 成功。
- **专家可调用**：`prepare(mode=agent)` 经该专家 `tool-lock` 解析出主工作流（`runnerWorkflow`，或 agent id 命中锁内工作流）成功 → `next` 返回的 prompt 中包含该专家 `prompt.md` 上下文 → `stop` 成功。
- **调用语法**：`/wf <workflow-id> [任务描述]`、`/wfa <agent-id> [任务描述]`。专家的工作流由 `tool-lock` 决定，**调用方不得指定**；需要"专家 + 指定工作流"属未来接口扩展，未落地前不得写进语法。
- **基础设施条目**：`wf-runner` 自身是引擎（自指定义 `action: script` → `cli.py`），登记在注册表中但不承诺 `/wf` 语义，列入 `ops/invocation_exceptions.json` allowlist（含理由与复核日期），并单列"基础设施清单"。
- **设计例外**：不可调用面分两类并在 `ops/invocation_exceptions.json` 登记——① **设计如此**：`wf-runner` 是引擎本身，自调用成环，不作为用户可调用工作流；② **平台能力缺口**：`repo-lint` 声明 `filesystem=shared-read-only-platform-report-write`，需要只读访问共享仓库，而脚本隔离只提供 copy-in 工作目录（只挂 release / work / environment），故按声明式权限判定被拒。②类在平台声明对应 `permissionAdapters` 之前保持不可调用；闭合路径（扩展隔离控制器只读挂载共享根 / 改 copy-in 扫描语义）需单独授权。**（2026-09-18 更正本条的现行适用性）** 上面 ② 的"缺口"表述已过期：0.7.5 起执行后端改为平台声明式 `executionBackend`，其 `sharedReadOnlyBinds` 把 `tool`/`agent` 以只读绑进 jail——第一条闭合路径已被采用（qoder 经用户逐平台单独授权，实测 jail 内可见且拒写、`repo-lint@0.3.0` live 扫描真过 `/wf` 到 `succeeded`）。**现在剩下的不是能力缺口而是版本对齐例外**：`scannerRelease=0.3.0` 的面上 `repo-lint@0.2.1` 那格在 claim 处失败关闭（共享侧缺陷③，依赖锁静默改写版本）。该授权是**逐平台**的，任何平台都不得引用 qoder 的结论申报自己已闭合。
- **机械执行**：各平台用本平台配置跑 `invocation_matrix.py`（zcode 现行：`zcode/bridge/ops/invocation_matrix.py --config E:/ai/zcode/bridge/zcode-config.json --exceptions E:/ai/zcode/bridge/invocation-exceptions.json`）。逐条资源 `prepare → next → stop`（脚本阶段默认不真跑），产出矩阵 JSON。**重跑面按 BP-3 分级，不再是"每批次全量"**：① **首次平台接入**与**引擎/契约大版本升级**（如 `0.7.x → 0.8.0`）跑全量；② 同一大版本内的补丁换代、新增/升级单个 tool / agent / 配方，只按内容哈希定位 delta 跑**受影响格**（`--only <id>`，或受影响 Profile 的那几格），未变资源沿用既有 digest；③ 只改文档不跑任何 run。**任何被跑过的面上出现非预期 FAIL 即阻断该批**。无论哪一级，都禁止省略 `--config`（会误用默认曾指向 Codex 的配置）。
- **脚本阶段例外**：矩阵默认不执行脚本阶段（避免副作用）；需要执行时用显式 `--execute` 白名单。
- **（2026-09-19，BP-5）批次的执行切块与完成判定**：任何接入/升级批次进入执行前必须给出**有序 P 步表**（单个 P 约 2–3 小时墙钟，内含 2–4 个各带可中断点的子块，最小格式见 `versions/架构基本原则.md` §5.1–5.3 与 §5.8；切块的正当理由是人的作息，不是任务的逻辑边界）。**验收判据在方案定稿时冻结**——上面"重跑面按 BP-3 分级"即是本轮定稿的判据，执行期不得追加验收项、不得提高门槛、不得以"再补一轮更严谨"延后宣布完成（加码的唯一合法时点是定稿之前，与 BP-3 §3.3 三问同向）。执行期新发现的漏洞与偏差，**只要不阻断当前 P 的判据、不违反基本原则 §6 红线，一律只做登记**（现象 / 复现条件 / 影响面 / 初步定位 / 建议处置），**项目收口后统一出一份修复方案**（另立 P 表）；当场处置仅限 BP-5 §5.4 的三类例外，且须在台账标为**越界处置**。**P 表全部按其预先写明的判据执行完毕且产出物可回读（`run-lock.json`、事件流、产物哈希、矩阵 JSON、机检报告）⇒ 该次更新即告完成**；等待型观察项归完成后的维护期，不构成完成的先决条件。

## 9. 平台接入最小接口（R2-1，2026-09-14 新增）

**原则：共享侧只定义接口与校验，不假定任何平台的实现方式；平台能力必须由平台声明。** 引擎与工作流定义中不得出现平台专有常量或具体 release 特例。

平台实现以下接口即视为具备接入条件（缺一即未接入）：

| 类别 | 项 | 要求 |
|---|---|---|
| 配置 | `platform` / `platformRoot` / `toolRoot` / `agentRoot` / `runsRoot` | 指向本平台目录；共享仓库只读 |
| 配置 | `runner` / `contracts` | **显式版本路径**（本平台自钉；不跟随共享 `current`，切换由本平台自行决定）。`contracts` 的版本号自 **runtime-contracts 1.1.0** 起可省略（省略即按契约目录自身的 `version` 解析），写成 `runtime-contracts/1.1.0` 或 `runtime-contracts` 均可 |
| 配置 | `bridge` / `capabilities` | 机器配置与能力声明文件路径 |
| 配置（2.0） | `scannerRelease` | 钉 repo-lint 的**扫描器释放版**（如 `repo-lint/0.3.0`）。阶段输入的 schema 从该释放版解析，因此它与 `defaults.workflowVersions` 里的 repo-lint **run 版**必须同代；不一致会在 claim 处 `INVALID_REQUEST` 失败关闭（缺陷③，见 `versions/架构2.0.0.md` §8） |
| 配置（2.0） | `executionBackend` | schema `wf-runner-execution-backend/v1`：`distro` / `interpreter` / `pathMap` / `verifyTimeoutSeconds` / `sharedReadOnlyBinds`。声明 `sharedReadOnlyBinds = [tool, agent]` 是 repo-lint 类"需只读访问共享仓"策略的**唯一闭合路径**（D04，须逐平台单独授权） |
| 配置（2.0） | `projectWriteRoots` | 项目级写根列表；引擎据此做**规范化后的项目互斥**（C5/ADR-4）。未声明即无项目互斥，不得宣称项目级串行已生效 |
| 可选 | `scriptEnvironment` / `environmentManifest` | 脚本阶段沙箱环境与其逐哈希清单 |
| 可选 | `peerDispatcherModule` / `peerChildExecutor` | 委派派发器与子任务执行器（模块路径）。2.0 起 `peerDispatcherModule` + `peerContentRoot` 成对声明；**能力位 `peerDispatch` 与这两个键必须同批声明**，只声明能力位会在派发时失败 |
| 配置（3.0） | `softwareRoot` | 第三共享仓根（`E:\\ai\\software`）。**BP-1 判据：三根共用同一套只读绑定**——本平台实测 jail 内 `shared/tool`+`shared/agent`+`shared/software` 三根均可见且写入全被内核拒（EROFS）；`repo-lint 0.4.0` 的 live 作用域在拿到 `--software-root` 却没有 `/shared/software` 挂载时**自己拒** |
| 配置（3.0） | `softwareGateway` / `softwareGatewayConfig` | 网关程序字节（run-lock 记其 sha256）与网关自己的配置文档（`softwareRoot`/`lockRoot`/`evidenceRoot`/`bodies`/`interpreters`）。引擎按 run 覆写 `evidenceRoot`，**`lockRoot` 保持平台级**——否则两个 run 不可能相互争用 |
| 配置（3.0） | `softwareRuntimeRoot` / `softwareEnvironment` | 本平台本体安装位与 `ai-software-environment/v1` 登记件（检出路径 + 逐文件哈希比对结果）；**本体不入共享仓、不跨平台复制** |
| 配置（3.1） | 软件行解释器回退链 | 判据 harness 为网关文档选解释器时按 **`config.interpreters[<suffix>]` → `softwareGatewayConfig` 里的 `interpreters[<suffix>]` 或 `python` → harness 自身进程的解释器** 三级回退，并把**是哪一级供给了**写进该行（`interpreterFrom`）。只带网关 config、没带运行器 `interpreters` 的平台从此能起软件行（D-59）；回退不是声明，读到 `sys.executable` 就说明本平台没显式钉过。任一级的文档读不出时按"该级没供给"继续回退，不崩 |
| 配置（3.0） | `softwareProfiles` / `softwareConsentGrants` | 平台声明的 profile（决定某 `sideEffects` 档位能否被允许）与已授予的确认门。`CAPABILITY_UNAVAILABLE` 必须点名缺的 config 键；grant 无到期即长期授权，但仍绑定**精确请求摘要** |
| 能力位（3.0） | `descriptor.actions['software-call']` + `descriptor.software` | 未声明该分面 ⇒  prepare 直接给机器可读能力缺口、**不尝试派发**；声明时必须同时写 `lockTableScope` 与 `crossPlatformArbitration`（后者在 3.0 仍是 **NOT satisfied**） |
| 能力位 | `peerDispatch` | 声明为 `true` 才允许委派；未声明时按协议拒绝，不得借用其他平台实现 |
| 能力位 | `math` / `mcp-tool-surface` / `scriptEnvironment` | 各自声明；未声明即视为不支持 |
| 传输面 | CLI 或 MCP 工具面 | **至少其一**；两者并存时语义须一致（同一协议、同一状态机） |
| 布局 | 产物只落 `runsRoot/<run-id>/` | 含 `state.json`、`events.jsonl`、`evidence/`、`run-lock.json` |

**（2.0 新增）标记为"（2.0）"的四行不是 1.0 接入判据**：按 1.0 接口接入的五平台（codex / zcode / qoder / doubao / workbuddy）不因其而变为"未接入"。反之，一个平台若要用 2.0 的能力（repo-lint live 扫描、脚本环境密封复算、项目互斥、peer 委派），必须自行声明相应键并**在自己面上实测**，不得引用他平台证据。**第三共享仓库 `software` 不在本节接口之内**：§9 无 `softwareRoot` 键、任何已发布 runner 都没有 `action: software-call`，因此**没有平台可以申报自己符合 3.0 接口**（3.0 尚未实施，见 `versions/架构3.0-software整合提案-20260917-v2.md` 与 `架构2.0.0.md` §10.4）。

**（2026-09-18，按 BP-1 / BP-2 / BP-3 补充三条口径）**

1. **三仓对称是必须项而非可选项**：`software` 曾"不在本节接口之内"，那只是**框架尚未实现**（不是设计把它排除在共享面之外）。**3.0 已实现（2026-09-21）**：上表新增的六行 `（3.0）` 就是 `softwareRoot` / `softwareGateway` / `softwareGatewayConfig` / `softwareRuntimeRoot` / `softwareEnvironment` / `softwareProfiles` 与 jail 内 `/shared/software` 进入本节接口表的落地，三根**同一套只读绑定**且在本平台控制器上实测（写拒绝＝EROFS）。在此之前各平台"只接到两根内容根"的状态按**接入未完成**登记进待补台账，不得表述为设计如此或平台自愿。
2. **接入完成有两个判据**：① 接口面 = 本平台配置下矩阵 FAIL 0（本节现有口径）；② 能力面 = 对共享侧从三仓 registry 集中算出的能力并集 **0 个 `declaredAbsent`**（BP-2 conformance floor）。只满足 ① 不得写成本平台功能已齐；核 ② 的时刻只有两个——平台声称接入完成、目录新增能力，**不是每 run 税**。
3. **本节接口表的一次性属性**：上表要求的是**首次接入**时的声明。之后新增 agent / tool / 配方，只要其所需能力（Profile）已被本平台声明过，就是**零本节改动**——索引追加 + `--only <id>` 单格冒烟即可（BP-3）。引入全新 Profile 才补 1 条声明并只核那一格。

**引擎硬编码（2026-09-15 已修复）**：profile 白名单、`game-code-review@2.0.1` 特例、契约版本字面量、唯一权限三元组——四项已在 `engine 0.6.0` 内全部改为平台/资源**声明**驱动（实测 grep 归零；profile 与权限策略改由平台 capabilities 声明）。**平台侧钉版属平台自决**：zcode 现钉 `repo-lint 0.2.1`；codex 仍钉 `0.1.1` 且其能力声明尚缺 `profiles` / `permissionAdapters`，**不可直接升 0.6.0**（否则每次调用都会被拒）；dsh 尚未接入；workbuddy 已接入（2026-09-16，钉 0.6.0 / 0.2.1，见 2.6）。接入步骤见 `versions/平台接入清单.md`。

**权限声明（2.0，`permissions.py` 封闭词表）**：三个维度各自只接受有限取值——`network ∈ {deny, egress-allowlist}`、`process ∈ {isolated-python, allowlisted-only}`、`filesystem ∈ {project-scoped, platform-runtime-write-shared-read-only}`。未知取值、未知维度一律**拒绝而不是宽松合并**（`UNKNOWN_PERMISSION`）；同一维度两方声明不同值即硬冲突（`PERMISSION_CONFLICT`）；一方未声明该维度记 `unspecified`，它本身不构成矛盾，但也**不能顶替**工作流的要求（要求侧 `unspecified` 直接 `PERMISSION_UNSPECIFIED`）。此词表**只在 `delegate` 路径上被校验**（`engine.py` 的委派分支）；非委派调用不经过它。

**由此导出的平台规约：本平台 `capabilities.json` 顶层不写 `permissions` 块。** 该词表表达不出现代描述符的分面语义（prompt 是 advisory、script 是 kernel、peer 是 mediated），把它塞进顶层只会在选版/校验阶段以 `UNKNOWN_PERMISSION` 失败关闭——qoder 在 2.0-B 轮实测到这一点（遗留值 `available-not-denied` 被拒），并把"顶层不填"写进基线。**分面不可相加**：一个平台可以 prompt 面宽松、script 面收紧，两者不构成一个"总权限等级"，任何求和或取平均的读数都是误读。能力缺位用 `declaredAbsent` 显式登记，不用权限字段暗示。

## 10. 隔离与并发（R4-1，2026-09-14 新增）

**结论表（不能并行者必须点明）：**

| 场景 | 能否并行 | 依据 |
|---|---|---|
| 不同 run 之间（同一工作流或不同工作流） | **可以** | 每 run 独占目录与独占文件锁；无跨 run 可变状态 |
| 同一 run 并发写 | **不可以** | `Store.lease()`（`.writer.lock` / `.executor.lock`）冲突即 `REVISION_CONFLICT: Another writer owns this run` |
| 单 run 内多阶段 | **不可以（契约硬性）** | 定义 `maxParallel` 恒为 1；状态只有单个 `activeAttempt` |
| 父运行与子运行（委派） | 父**等待**子 | 派发器按序号物化并等待子运行终态 |
| 同平台共享脚本环境内的脚本阶段 | **建议串行** | 仅当该平台声明了脚本环境；跨平台互不影响。zcode 2026-09-17 起无脚本环境，不适用此行 |
| 同一规范化项目写根上的两个 run | **不可以（争用即拒）** | 2.0 起由引擎按 `projectWriteRoots` **规范化路径**互斥（ADR-4 / C5）。行为是**拒绝式**：后到者拿 `RESOURCE_BUSY` 且**不留半截产物**；不是"两个都跑完"。未声明 `projectWriteRoots` 的平台**没有**这层互斥，不得引用他平台结论 |
| 不同项目写根 / 不同平台 | **可以** | 规范化路径不同即不共享锁；跨平台各自 `runsRoot`。不同项目可并行 |
| tool 与 tool、agent 与 agent 相互之间 | **互不影响** | 共享仓库只读 + 逐版本哈希；运行产物各自落本平台 `runsRoot` |
| **（3.0）软件配方之间** | **互不影响** | 仓库级：只读共享配方，本体各平台自装；一个配方换代不影响其他配方（同 tool/agent 原则）。配方 `concurrency` 段必填，缺失或与快照矛盾即发布校验拒绝（`repo-lint 0.4.0`） |
| **（3.0）不同 run 调同一 `per-run` 软件（C6）** | **可以** | 实例级不Claim 任何键；每 run 独立网关会话与独立 `evidence/software-calls/`。**本平台实测**（`3.0-A/baseline/s8-concurrency.json`）：两 run 各用自己的项目副本，两个 body 进程 pid 不同、起止区间**重叠**（合体窗口 3.26 s，一次 hold 3.2 s、串行应为 6.4 s），两条 `outputSha256` 不同 ⇒ 证据互不串 |
| **（3.0）不同 run 调同一 `pooled` 软件** | **并行度＝`poolSize`** | 网关按 `hash(holder) % poolSize` 占槽，同槽第二个即忙 |
| **（3.0）两 run 抢占同一 `singleton` 软件 / 同一 `exclusiveResources` 键（C7）** | **不可以（争用即拒，被拒者零副作用）** | **本平台实测**：被拒方 `SOFTWARE_BUSY`(`retryable: true`) 且**从未进入 body**（body 自记日志只多一家）、其 run 内**无** `evidence/software-calls/`、**无**台账行、`stateRevision` 与拒绝前一致、被争项目副本字节不变；holder 停止后新 run 正常取得实例（串行恢复），被拒 run 仍可干净 `stop`。登记 **D-51**：被拒 attempt 重跑答 `UNKNOWN_OUTCOME`（其实什么都没派发），修法＝锚点三态化 |
| **（3.0）同一项目副本被两个 live run 写** | **不可以（prepare 即拒，被拒者连目录都不建）** | 引擎按 `x-arbitration-key`（run 粒度独占键）在**中立 handoff 层**认领；冲突答 `RESOURCE_BUSY` 且发生在 `store.root.mkdir()` 之前 ⇒ 磁盘上零落盘（实测 `rivalRunDirExists: false`） |
| **同一项目在两个平台上各开一个 run（跨平台并行写）** | **当前无仲裁 = 不安全，不得开** | 现有互斥键只在**单平台内**有效（`projectWriteRoots` 规范化路径 + 本平台文件锁；3.0 网关锁表落 `<platform>/runtime/software-gateway/state/` 同样只在平台内）。两平台各自持锁 ⇒ 引擎看到的是"没有对手"，会真并发写同一份文件。**在 BP-4 ③ 的跨平台仲裁落地前，跨平台只能并行"互不相交的项目副本"** |
| **一个 run 中途换平台续跑** | **不可以（设计边界）** | run 是平台本地 + 单写者，状态机不搬。**允许且被 BP-4 要求的是 run 粒度续跑**：导出中立交接包 → 另一平台 rehydrate 成新 run，功能面不得缩小、版本必须一致 |

**（2026-09-18，BP-4）本表的跨平台口径与待补机制**：本表此前只回答"同平台内能否并行"，隐含假设"一个项目只在一个平台上跑"。该假设不再成立——用户口径要求"一个项目拆成多个 run 分布在不同平台跑时，感觉跟在同一个平台上跑一样"。按 `versions/架构基本原则.md` BP-4 裁定：

1. **"无缝"的定义域 = run 粒度的续跑等价**（一次交接、零手工拼装、功能面不因换平台缩小、换平台前后钉住的版本一致）。进行中的单个 run 不做在线热迁移，这条是设计边界而非缺口，但**不得**用它来拒绝下面必需的机制（2026-09-22 基本原则 1.3：原三项裁减为两项）。
2. **必需机制两项（2026-09-22 基本原则 1.3 由三项裁减为两项），缺一即视为本条未满足**：① **续跑版本一致性校验**——目标平台所钉 agent/工作流/依赖/软件配方版本与锁内版本不一致时明确警告或拒绝，不得静默换版（同时封堵 2.0.0 §8 缺陷③ 的静默改写）；② **可回读的带 sha256 交接载体**——续跑所需的项目可写状态、跨 run 版本锁、已完成阶段的结论与产物摘要，以带 sha256 与 provenance 的交接包（`handoff-bundle/v1`）或用户指定的共享路径承载，**任何平台不得直读别平台 `runtime/`**。
   ~~原 ③ 跨平台资源仲裁~~（可写项目根与 exclusive 资源——单例软件、固定端口、网卡、设备、许可证席位、数据目录——的互斥键必须在所有平台之间有效）、~~必须建一个不属于任何平台的中立状态层目录~~、~~并行是一等能力（共享编排模板）~~ 三项自 2026-09-22 起**撤销为必需项**。**撤销 ≠ 修好**：已实现的 3.0 网关锁表与 `exclusiveResources` 全部保留，作用域如实声明为**同一平台内**。**明写的代价**：同一项目副本被两个客户端同时开工不会被任何机制发现或阻止，两边会互相覆盖；任何文档不得把它写成"架构已提供跨平台互斥"。若将来出现真正的分机执行需求，按 BP-5 另立 P 表重新裁定。
3. **划界**：本节"产物归平台"约束的适用对象是**运行私有产物**（配置、凭据、缓存、日志、run 私有一手证据、本体安装位）。被声明为**项目状态**的内容按 ① 走中立层，不属于"平台状态"，因此不构成本条禁令的例外冲突。
4. **落地归属**：① ② 与并行编排模板已在 `versions/架构2.1.0-更新方案.md` §3.6 成型为 `handoff bundle` 提案（BP-4 的承接件，**必须纳入 2.1.0 范围**）；③ 的跨平台部分由本表与 3.0 §5.3 共同承接。

**证据要求**：C1–C4 曾由 `zcode\workspaces\agentic-workflow-implementation\tests\test_concurrency.py` 实测通过；**该工作区 2026-09-17 已删除**，完整报告不在 zcode runtime，摘要见 `codex/workspaces/github-export-architecture-evidence-1.0.0/`。**C5（同项目写根串行）已于 2026-09-18 由 qoder 在其 0.7.6 生产面上实测**：`qoder\runtime\maintenance\2.0-C\baseline\K3-writeback-key.json`（case-7 逐分支留痕）。断言口径**只能是"争用按设计被处理"**——两个并发写者要么都成功、要么一个成功另一个 `RESOURCE_BUSY`，且被拒者**不留文件**；**不得写成"两并发都成功"**，那与拒绝式互斥的设计相反。2026-09-15 那句"沙箱现已可测"仍**作废**：那是针对 zcode 的措辞，zcode 重建后无脚本沙箱，其面上 C5 类脚本并发仍不可测。综上：本表"同一规范化项目写根"一行**有实测、但只在 qoder 一家**；其余平台未声明 `projectWriteRoots` 前不得据此宣称已验证。

**文档义务**：本表为唯一权威表述，各平台章只写一行指引（"并发结论见本文 §10"），不各自发明；如某平台实测发现例外，先更新本表再改平台章。

## 11. 场景词汇、提示词锚点与 claim 字段（3.1.0，2026-09-23 新增）

**这一节是机器判据认的词汇表**，不是建议写法：`repo-lint 0.5.1` 的 R5/R16 与 `wf-runner 0.10.0` 的 `plan()` 都按这里的名义校验。

### 11.1 定义代（`ai-workflow-definition/v3`）

v3 = v2 + 三个顶层键，阶段项结构与 v2 **逐字同义**（v3 模式文件由 v2 派生生成，不手抄）。

| 键 | 含义 | 判据 |
|---|---|---|
| `defaultScenario` | **v3 必填**（C-2）。省略 `scenario` 时走它，且展开图必须与显式传该值逐字相同 | 缺该键 ⇒ v3 契约校验 error（运行时才发现是不允许的） |
| `requiredStages` | 必经阶段集合（C-1/C-7 的可机判载体） | 场景 `remove` 命中其中任一阶段 ⇒ `plan()` 期 `INVALID_REQUEST` 并点名该阶段 |
| `scenarios.<id>` | 场景，体为 `{summary, add, replace, remove, order, gates, skills, defaults}` | 未声明的场景名 ⇒ `INVALID_REQUEST` 并列出真实场景集 |

场景体的三条硬界（C-1 裁定，全部由 `plan()` 现有检查咬，不另开口子）：**不得引入 `action` 枚举外的动作**；**不得移除 `requiredStages`**；**只能增删门禁实例**（门禁名必须存在于 `gateDefinitions`，不得改门禁的类型集合）。`replace` 是**补丁**不是整阶段：它只要求 `id`，合并后仍走完整阶段检查；`order` 必须是展开后阶段集的排列；`gates` 的键必须是真实阶段；`skills` 必须是本流程 `dependencies.skills` 声明过的技能（写成 `skill@精确 semver`）。

### 11.2 提示词锚点语法（D-72：此前从未成文）

`promptRef` / `repairPromptRef` 形如 `workflow.md#stage:INTAKE`，指向定义文件同目录下的正文文件里**成对的 HTML 注释锚点**：

```markdown
<!-- stage:INTAKE -->
（该阶段的正文，非空）
<!-- /stage:INTAKE -->
```

写成 Markdown 标题（`## stage:INTAKE`）**不被识别**，R7 判 `prompt-anchor` error；锚点缺失、重复、嵌套或不配对同样是 error。

### 11.3 上下文注入（F-1）与 pack 的语义

注入集 = `execution.contextSkills`（prepare 算好并钉进锁）：场景点名了技能就以场景为准，未点名回落到 `dependencies.skills`。**`dependencies.packs` 不贡献文本**——pack 释放本来只有 `manifest.json` + `SHA256SUMS`（键是 `skillIds` / `skillVersions`），引用 pack 的语义是它的**成员技能**（本次 run 已钉住的那些）加入注入集。因此"用了 pack"是可机判的，不是登记一行就算。声明了却解析不到 ⇒ `CONTEXT_UNRESOLVED`（发生在锁提交之前），入锁摘要与盘上不符 ⇒ `INTEGRITY_MISMATCH`（不得把篡改报成缺能力）。

### 11.4 入锁与 claim 字段（平台必须能读回）

`run-lock.execution` 新增：`scenario`（字符串或 `null`）、`expandedGraphSha256`（必填，**计入 promptRef 目标与门禁名**，续跑时重算比对，不符 ⇒ `VERSION_CONFLICT`）、`contextSkills`、`rigorSource`（`declared` / `default`，区分"没写档位＝草稿"与"显式要了 balanced"）。claim（`next` 返回的 `task`）新增：`rigor`、`rigorSource`、`gated`、`frozen`、`tierNotice`——**档位可见不靠改提示词字节实现**。软件行在 harness 侧多一个 `interpreterFrom`，标明解释器由哪一级供给（D-59 的回退链：运行器 config → 网关 config → 本进程解释器）。

### 11.5 平台接入差异（3.1 增量）

本节不新增接入项：`declaredAbsent` 判据、`conform` 一条命令、矩阵 45 格口径照旧。新流程/新场景属**索引追加**，复用已声明 Profile 时零平台改动（BP-3）。**实测例外**：`repo-lint --select` 目前不退化到单格成本（57.4 s vs 全量 58.8 s，D-82），单格冒烟请使用 `platform-conformance 1.4.0` 的 `conform --only`（0.1 s，且未知 id 现在判 FAIL 而非假绿）。
