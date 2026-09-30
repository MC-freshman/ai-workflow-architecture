# Agentic Workflow 总手册（统一版 v2.0）

> 作用：本文件是 agentic workflow 的当前唯一执行总览，把早期实施计划、优化计划与里程碑手册统一到一处。**〔2026-09-30 整理更正〕** 三份 2026-09-07 早期底稿对应的 Phase 0 → 1 → 5A → 2 → 3 → 4 已全部执行完毕，底稿已在待清理区，按「治理文本不把 inbox 当现行依赖」原则摘除其路径引用，不再作为历史附录入口；历史脉络一律以本文件与 `versions/更新日志.md` 为准。
>
> 当前口径：正式一级目录为 `codex / dsh / workbuddy / zcode / doubao / tool / agent / software / inbox / qoder / versions / .zcode / docs-site / architecture-manager`（`software` 于 2026-09-18 经用户授权设立，见下；**`ai学习笔记` 已于 2026-09-29 由用户迁入 `inbox/ai学习笔记/`，不再作为根级一级目录**）；`claude code` 仍仅作登记项，未自动纳入正式平台接入面。**现行架构基线为 `versions/架构2.0.0.md`（2026-09-18 定稿，带偏差；配套 `架构2.0.0-迁移指南.md`、`架构2.0.0-恢复手册.md`）；`versions/架构1.0.0.md` 为已冻结的上一基线。** 接入与能力以 `HANDOFF.md`、`versions/架构2.0.0.md` §9、`versions/平台接入清单.md` 为准。

## 1. 现行架构边界

**上位基本原则 BP-1 ~ BP-5（全文与判据：`versions/架构基本原则.md`；本节其余描述都是现状，不是目标）**：

- **BP-1** 三仓骨架不可变——`tool`+`agent`+`software` 的存在、职责与同构形态（指针 / 语义化版本目录 / `SHA256SUMS` / 钉版 / 一句话切换）不得被取消、合并、降级或绕过；仓内只放可冻结可共享的文本。
- **BP-2** 平台对等——能力并集从三仓 registry 集中算一次、对所有平台逐字相同；**接入完成判据 = 0 `declaredAbsent`**；作者/定稿身份不产生运行时特权；未达差异只能是时间差，不得写成永久分层；共享代码禁平台专有常量/路径/release 特例；结论不互抄。
- **BP-3** 验收与接入最小量——除必要时间与 token 外一律最小（风险比例 / 哈希增量 / 单条 `conform` 出 digest / 只留能抓真失败的检查 / 全矩阵只在首次接入与大版本升级）；复用已声明 Profile 的新资源 = 零平台改动 + 单格冒烟；新增验收先过三问。
- **BP-4** 跨平台同一项目语义——一项目拆多 run 跨平台跑须等价于单平台连续跑；**两项**机制（续跑版本一致性校验 / 可回读的带 sha256 交接载体）即为必需，**并行与跨平台资源仲裁自 2026-09-22 起不再是必需项**（三项裁减为两项，见 `versions/架构基本原则.md` BP-4 1.3）；进行中单 run 不热迁移（设计边界）。代价明写：同一项目被两客户端同时开工不会被发现，会互相覆盖。
- **BP-5** 分步实施与完成判定——进入执行的方案必须先给有序 P 步表（每个 P 约 2–3 小时、内含 2–4 个带可中断点的子块，切块理由是人的作息而非任务的逻辑边界）；批准后严格照案执行，非阻断缺陷只登记不当场修，收口后统一另出修复方案；**P 表按其预定判据跑完即＝更新完成**，不得追加验收项、不得改判据、不得出现"跑完了还不算完成"（等待型观察项归完成后的维护期）；完成＝判据满足 + 既有产物可回读，红线不因本条削减。
- **BP-6** 入库先行——任何架构更新 / 平台接入 / 发布 / 修复，宣布完成前必须把治理文本与平台配置面提交进根仓 git，**破坏性动作之前先有可回滚 commit**；推送前过凭据 / 本体 / 大文件扫描，禁止强推；收口报告必带四项读数；没有入库读数的「完成」按谎报处理
- **BP-7** 不可入库件隔离与备份——进不了 git 的东西（venv、密封脚本环境、软件本体、真机数据目录、大缓存）按平台隔离在 `<platform>/runtime/`，并在 `inbox/backup/<platform>/` 留登记（可重建件交"重建配方 + 逐文件 sha256 + 一条重建命令"，不可重建件留完整副本）；**未经一次真实恢复演练按未备份处理**

**按 BP 的现状定位（2026-09-18 原文，已被 09-21/09-22 超出，保留作历史读）**：~~BP-1 结构上成立但 software 未接线（三仓实际只有两仓被共享）~~ → 3.0 后 `software` 已成真正同构第三仓，qoder / codex / workbuddy 三家接了第三根，zcode / doubao / dsh 仍只接两根（时间差）；BP-2 三家已各自出 45 格 `FAIL 0`，余三家未接；BP-3 的方向由 2.1.0 §0.2 承接、3.0 判据按其收敛；~~BP-4 未满足，唯一对症机制（`handoff bundle`）尚未定归属~~ → `handoff-bundle/v1` 已发布并被引擎消费，且 BP-4 本身已于 2026-09-22 裁减为两项机制；BP-5 自 09-19 起为全部轮次的执行纪律（3.0-A / 3.0-Q / 3.0-R2 三轮均带 P 表）。

- 运行平台目录六个：`codex / dsh / workbuddy / zcode / qoder / doubao`。其中 **5 个已接入**，**`dsh` 尚未接入**。总框架与分章：[HANDOFF.md](HANDOFF.md)。
- 上面"已接入"的判据面是**架构 1.0**（矩阵 38 PASS / 2 EXPECTED / 0 FAIL，per-平台 pin + 默认指针）。**架构 2.0 的六个配置键（contracts 1.1.0 / scannerRelease / executionBackend / projectWriteRoots / peer 双键 / 可选版本解析）截至 2026-09-18 定稿时点只有 `qoder` 接进生产（09-18 晚 2.0-D 起为 `wf-runner 0.7.7`）**；其余四平台的 2.0 能力**未测**，不得由本手册替它们申报。逐平台读数见 `versions/平台接入清单.md` 与 `versions/架构2.0.0.md` §9。 **〔2026-09-19 2.0-H 框架收口轮〕** 按 BP-5 把 2.0 的账分成**框架**与**平台**两类判：框架侧（三仓发布形态、引擎与契约字节、判据工具、文档自洽）在 `versions/架构2.0.x-框架收口与修复方案.md` 的 F-P1…F-P3 与 X-P1…X-P6 跑完时收口；平台侧（各平台生产接入、四门逐平台出证、能力地板到 0 `declaredAbsent`、48h 观察窗口）**一律移交各平台自己出证，结论不互抄**（BP-2 §2.6），本轮不代为宣布任何一项满足。逐条归属见 `versions/架构2.0.0.md` §10.0 与 §13；本轮新登记 D-22～D-26（含"门3/门4 的驱动脚本仍在盘上、缺的只有 fixture 与 baseline 产物"这一实测成本更正）。 **〔同日 2.0-X 修复轮已执行〕** 框架侧欠账按 `versions/架构2.0.x-框架收口与修复方案.md` 的 X-P1…X-P6 跑完：发布 **`wf-runner 0.7.9`**（D-15 协议交付固定 UTF-8 / D-16 交付失败不再伪装成入参不合 / D-12 可分类半）、`architecture-ops 1.1.0`（判据 harness 首次成为共享版本件，D-10 组）、`platform-conformance 1.1.0`（CON-04 逐字回读 `evidenceBindings`，D-11；`-t .` 运行命令，D-20）；共享 current 现值 `wf-runner 0.7.9` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0` / 两个治理包 `1.1.0`。qoder 生产仍自钉 0.7.7。台账 `qoder/runtime/maintenance/2.0-X/`，账见清单 §8.14。

**〔2026-09-20 架构 2.1.0 框架侧执行轮（2.1-A）〕** 按 `versions/架构2.1.0-定稿实施表-20260919.md` 的 P1…P9 逐行跑完（框架侧）。发布三件，全部新目录、零改写已发布字节：**`wf-runner 0.8.0`**（A 轴三档 `rigor`：门禁执行 / seal 文档 / 往返次数按档增减，**功能面三档一视同仁**；每 run 一次权威环境哈希 + 之后增量复用，实测 7 100 文件全量 87.8 s → 增量 23.6 s、比值 0.269 ≤ 1/3；§3.2 脚本执行降级阶梯 `kernel-sandbox → platform-venv → host-controlled`，其中主机一档**必须本次请求自带用户同意**且同意摘要进锁；BP-4 三机制：平台中立 `handoff-bundle/v1` 交接包、续跑版本一致性**不一致即拒绝、不得静默换版**、exclusive 资源仲裁键同键互斥且被拒者零落盘）、**`runtime-contracts 1.2.2`**（`ai-run-lock/v1.2` 的 `execution.rigor/gated/frozen/execPath/hostConsent`、"无密封环境"的合法锁形态、`handoff-bundle/v1`；`state` 规则 2 只做**收窄式**例外，普通 run 的"prepared ⇒ completed 必空"一字未动）、**`platform-conformance 1.2.0`**（一条 `conform` 命令集中算三仓能力并集，出 pass / `declaredAbsent` / 未测 三类清单 + 两个摘要，每条缺口必须带补齐路径与**整数分钟**成本，报告内不得出现"本平台不支持"措辞）。**D-27 自此两面闭合**（契约半 1.2.0、语义半 0.8.0：声明不出密封脚本环境的平台，提示词面照常跑到 `succeeded`，脚本面回答结构化 `CAPABILITY_UNAVAILABLE` 且不留半截产物）。**发布 ≠ 采纳**：共享 `current` 全部未翻（`wf-runner 0.7.9` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0` / 两个治理包 `1.1.0`），**qoder 生产仍显式钉 `0.7.7`**；在发布字节上复跑受影响电池并跑一次 39 格全矩阵 `FAIL 0`（`PASS 38 / NEEDS-INPUT 1 / EXPECTED 0`，784.5 s）。**采纳 0.8.0 的平台必须在自己 config 里声明 `scriptEnvironmentRungs`**（P6 阶梯的入口）：只带旧单键 `executionBackend` 的配置，脚本派发会 fail-closed 而不是静默沿用——这是本轮实测到的迁移要求，本平台生产因仍钉 0.7.7 未受影响。仍未完成的都是平台侧：其余五平台各自采纳与自证（结论不互抄）、48 h 等待型观察窗口、P8b 跨平台续跑演练与中立层目录落点的单独授权（`qoder/runtime/maintenance/2.1-A/HANDOFF-P8b.md`）。台账 `qoder/runtime/maintenance/2.1-A/2.1-LEDGER.md`，账见清单 §8.15。
- `tool` 是共享工作流仓库，`agent` 是共享专家仓库，`software` 是共享软件配方仓库（架构 3.0，只存 manifest/recipe/schema/selftest/说明书，**不存软件本体**；本体由各平台按 recipe 装进自己的 `runtime/software/`）；三者已发布版本只读，不覆盖旧目录。
- `inbox` 是待整理区，只做登记和隔离，不自动发现、不自动执行。
- `ai学习笔记` 是用户内容区，不按运行平台自动执行；**2026-09-29 起它位于 `inbox/ai学习笔记/`，不再是根级一级目录**。`qoder` / `doubao` / `workbuddy` 已不是“待验证 / 非运行平台”。
- 任何 agent / workflow / tool / skill 的运行，都必须固定版本、记录来源，并写入所属平台 `runtime\runs\<run-id>\run-lock.json`。
- 调用 `math-modeling-programmer` 时全平台同一档位（`invocation-adapters-spec.md` §3.1）：未写 = 草稿，不默认九阶段。

## 2. 当前状态快照

**2026-09-15：Z10 四条验收要求全部实测收口（zcode 会话）**。① 默认指针矩阵 **PASS 38 / EXPECTED 2 / FAIL 0**（25 条工作流走 `/wf` + 13 个专家走 `/wfa` 全部可调用）；② 引擎内资源级硬编码实测归零——profile 白名单、`game-code-review@2.0.1` 适配器、契约版本字面量、唯一权限三元组全部改为平台声明，`wf-runner 0.6.0` 已发布并为本平台选版；③ 一句话切默认共实跑 **11 次指针切换 + 9 处注册表字段改写**（S1 33 条、S2 平台钉版、S3-5 引擎选版、上架 6 条、补批 3 条、数模成对 2 条），并做过一次逐字节回滚演练；④ 并发结论见 `invocation-adapters-spec.md` §10（C1–C4 实测通过、C5 如实记 NOT_RUN）。**两条例外**：`wf-runner`（设计如此——引擎自身不可自调用）、`repo-lint`（平台能力缺口——其策略需只读访问共享仓库，而脚本隔离只提供 copy-in 工作目录；用户 2026-09-15 选定接受例外，两条闭合路径均需单独授权）。全系统锁滞后归零。终检原始 JSON 已随 2026-09-17 zcode 重建删除；摘要副本：`codex\workspaces\github-export-architecture-evidence-1.0.0\`。现行 zcode 矩阵：`zcode\runtime\matrix-smoke\reconnect-final.json`。**〔本段是 2026-09-15 快照，不得整段当现状读；其中两处已被 §5 更正——② 的 `repo-lint`「平台能力缺口」重新定性为版本对齐例外，④ 的 C5「如实记 NOT_RUN」已于 2026-09-18 实测。〕**

主方案序列 `Phase 0 → 1 → 5A → 2 → 3 → 4` 已全部执行完毕。**2026-09-13：共享默认已按用户指令切换（两批 16 项，含回滚演练与切换后核验）**；**2026-09-14：G1 / G2 / G3 三道门全部闭合**（G1/G2 由 Codex 在 0.5.2 上补验，G3 由 zcode 真实业务委派验收），桌面 MCP 工具面 10 工具实调通过。合并记录：`zcode\runtime\runs\20260913-postcomp-11\reports\session-summary.md`。

2026-09-13（**当日历史，已被后续接入与 9-17 zcode 重建改写**）：数模比赛已结束，比赛期限制解除；ZCode 赛后批 P6–P12 启动（计划稿原在已删除的 `zcode\workspaces\agentic-workflow-implementation\docs\zcode-integration-plan.md`）；qoder **当时**登记为待验证接入区（**现已升格**，见 `HANDOFF.md`）。同日按用户指令完成：默认切换（16 项）、ZP-7 数模路径 9/9、U6 mastermind 业务工作流升级（父工作流 2.0.0 + 六子专家可运行工作流）与 G3 真实委派验收、math 历史 `__pycache__` 清理（R11 归零）。ZP-7 / G3 的完整 runtime 证据已随 zcode 重建删除，不得当现行能力。

已完成、并有证据的部分如下：

| 里程碑 | 当前状态 | 说明 | 主要验证 |
|---|---|---|---|
| M1 | DONE | repo-lint 与仓库契约整理 | `phase0-completion.md`、`repository-health.md`、repo-lint 0.1.1 发布证据 |
| M2 | DONE | runner 最小闭环与数模试点 | `phase1-completion.md`、69 项回归、双链合成对照、回退演练 |
| M3 | DONE | 通用 gate 与视觉门禁迁移 | `phase2-gate-01` 证据、gate 11 / viz 4 验证 |
| M4 | DONE | game 单试点 | `phase3-sprint-01` 证据、新旧对照与扩展决策记录 |
| M5 | DONE | peer-lock 与受控委派 | `phase4-peer-01` 证据、peer 精确锁与拒绝链路 |
| M6 | DONE | run-lock / state / events / evidence 契约 | 幂等、崩溃、终态、提交一致性验证 |
| M7 | DONE（分段完成） | 发布保障、根级收编、自动化 | release_tool、root-items、Z 批次与回退证据 |
| M8 | DONE（按批次） | 测试、黄金对照、验收台账 | 69 项回归、两条合成黄金链、视觉 QA 与冻结证据 |

## 3. 递进关系

这份总手册的阅读顺序应当是：

1. 先看本文件，确认当前状态与边界。
2. 再看 `AI_ARCHITECTURE_SYSTEM_PROMPT.md` 和 `AGENTS.md`，确认工作区规则。
3. 需要版本、接入和桥协议时，去看 `invocation-adapters-spec.md`；各轮平台接入的执行步骤、P 表与逐格读数见 `versions/平台接入清单.md`。
4. 需要平台接手与剩余任务时，去看 `HANDOFF.md` 与 `post-competition-closeout.md`。

## 4. 已完成部分的证据口径

已完成的内容必须同时满足三件事才算闭合：

- 有对应版本或运行目录；
- 有测试或回归结果；
- 有可读的完工记录或报告入口。

常用证据入口：

- `E:\ai\codex\runtime\runs\20260905-phase0\reports\phase0-completion.md`
- `E:\ai\codex\runtime\runs\20260905-phase1-implementation-02\reports\phase1-completion.md`
- `E:\ai\zcode\runtime\runs\20260907-phase2-gate-01\`
- `E:\ai\zcode\runtime\runs\20260907-phase3-sprint-01\`
- `E:\ai\zcode\runtime\runs\20260907-phase4-peer-01\`
- `E:\ai\zcode\runtime\runs\20260907-closeout-z01\`
- `E:\ai\zcode\runtime\math-smoke\`（数模链路就绪实测：环境/工具链/图表 QA/视觉审查闭环，2026-09-08）

## 5. 状态与开放事项（已闭合项 + 仍开放项；2026-09-15 实测）

- `G1` ✅ **已通过（2026-09-14，Codex）**：runner 0.5.2 上数模双链各 9/9 阶段成功、数值与预览哈希一致；历史基线 69/69 + 四能力套件 46/46 保留。
- `G2` ✅ **已通过（2026-09-14，Codex）**：`sprint-plan` 2.0.1 vs 2.1.0 同输入 5 类用例对照；缺信息用例 2.1.0 自动阻断（未编造）。
- `G3` ✅ **已通过（2026-09-13，zcode）**：父运行五阶段 succeeded，6 个专家子运行 completed（真实 runner 子运行 + 血缘），三类拒绝边界零副作用。
- 已闭合用户决策项：`U1`（默认切换，2026-09-13 两批 16 项）、`U6`（mastermind 业务工作流升级并切默认）、`U2`（M4-10 解冻：design-review / postmortem 2.1.0，2026-09-14）、`U7`（工作区 `.zcode` 白名单登记并落地）、`U8`（`E:\ai\grok` 隔离到 inbox，2026-09-14）。共享默认当时另含 `repo-lint 0.1.2`（2026-09-14 切换；**现为 `0.2.1`**，见 §2 与 `versions/架构1.0.0.md`）。
  - （**历史 2026-09-14**）阶段一与 ④ 完成时的状态：当时默认 `repo-lint 0.2.0`、`expert-task 1.0.0` 与四个专家候选已出，`--targets` 矩阵 PASS 22 / EXPECTED 18 / FAIL 0；profile 档按 Z10 §2C-B 从 tool-lock 迁到 `policies/`。证据：`zcode\runtime\runs\20260914-u3-repo-lint-020\reports\{step4-acceptance.json, invocation-matrix-step4.json, switch-postchecks.json, impact-repo-lint-0.2.0.json}`。以上数值均已被 2026-09-15 的收口结果取代。
- `U3` ✅ **已完成并上架（2026-09-15，zcode）**：四个候选专家与 `expert-task` 的默认切换已执行（`expert-task 1.1.0`、`game-builder 1.8.0`、`novel-writer`/`software-engineer`/`security-researcher 1.4.0`、`visualization-engineer 1.6.0`）；17 条 legacy 迁移（批 A @2.2.0、批 B/C1/C2 @2.1.0）与 7 个 pack 钉版也已切换；⑦ `engine 0.6.0` 已实现、发布并成为本平台选版；平台 `contracts` 钉版由 0.1.1 升至 0.2.1；`expert-task` 的 repair 可达性问题随 1.1.0 修复（新增脚本 `process` 门禁，真实 run 对照：不合规 → 进入 repair、合规 → 一次通过、run 终态 succeeded）。证据：`reports/switch-golive-report.json`、`switch-agents140-report.json`、`switch-mathpair-report.json`、`s3-6a-expert-task-ledger.json`、`s4-four-requirement-final-check.json`。
- 接口与并发已入规范：`invocation-adapters-spec.md` 新增 §8 可调用性判据（含矩阵门 `ops/invocation_matrix.py`）、§9 平台接入最小接口（共享侧只定接口与校验，平台能力必须由平台声明）、§10 隔离与并发结论表（跨 run 可并行、同 run 串行、同项目/同脚本环境资源级串行）。
- 补齐路径曾成稿于 `zcode\workspaces\agentic-workflow-implementation\docs\architecture-completion-plan.md`（Z10 修订 1，2026-09-14）。**该工作区 2026-09-17 已不存在**；结论已写入 `versions/架构1.0.0.md`。不要再按那份路径执行。
- **仍开放（2026-09-18 复核）**：`U4` claude code 目录归属（实查不存在）；`U5` inbox 终局（9-16 已部分清理，余量以 closeout 与 inbox 台账为准，不自动删除）；`repo-lint` 的例外**已重新定性**：不再是"平台能力缺口"，而是**版本对齐例外**——qoder 面已用 D04 共享仓只读绑定 + `repo-lint@0.3.0` live 扫描端到端闭合（`qoder/runtime/maintenance/2.0-C/baseline/K1b-repolint-live.json`），但**共享 `current` 仍是 `0.2.1`**，其余平台的闭合仍取决于各自是否声明 `executionBackend.sharedReadOnlyBinds`。`workflow-scope-registry` 的 `repo-lint@0.2.1` 行在 qoder 面记 1 FAIL（`scannerRelease=0.3.0` 时 0.2.1 的 run 被套上只有 0.3.0 才有的 scope/live 约束，claim 处 INVALID_REQUEST 失败关闭）；这是缺陷③，不是可调用性结论。（**0.7.7 后状态**：缺陷③ 已在 `wf-runner 0.7.7` 闭合——该格现为落盘前 `VERSION_CONFLICT` 明确拒，静默改写不复存在，可调用性未变；见 `versions/架构2.0.0.md` §8。）
- **C5 已实测（2026-09-18，qoder 0.7.6 生产面）**：`qoder/runtime/maintenance/2.0-C/baseline/K3-writeback-key.json`。判据必须写成**"争用按设计被处理"**——两个并发写者要么都成功、要么一个成功另一个 `RESOURCE_BUSY`，且**被拒者不留半截文件**；**不得写成"两并发都成功"**（那与互斥锁的设计相反）。zcode 重建后无脚本沙箱，其面仍不可测，不得由 qoder 的结果替它申报。

## 6. 早期底稿的去向（2026-09-30 更正）

本节原列出三份 2026-09-07 早期底稿（`agentic-workflow-implementation-plan.md` 主实施总账、`agentic-workflow-optimization-plan.md` 技术设计、`agentic-workflow-milestone-runbook.md` 步骤与恢复模板）在 `inbox` 的路径。三份底稿对应的 Phase 0 → 1 → 5A → 2 → 3 → 4 已全部执行完毕；2026-09-30 目录整理时底稿位于待清理区，按「治理文本不把 inbox 当现行依赖」原则摘除路径引用，随当批清理授权处置。当前状态一律以本文件为锚点，不再保留任何指向 inbox 底稿的入口；历史脉络见 `versions/更新日志.md`。

## 7. 3.1.0 的场景层（2026-09-23）

- 一专业领域 = **一个专家 + 一条通用 workflow + N 个场景 skill**。定义代是   `ai-workflow-definition/v3`（= v2 + `defaultScenario` / `requiredStages` / `scenarios` 三键，阶段项逐字同义）。
- 技能正文第一次**真的**进提示词：注入集由 prepare 算成 `execution.contextSkills` 钉进锁；场景点名技能即以场景为准，  未点名回落到流程自己声明的那组；pack 只贡献成员技能、不贡献文本。
- 展开结果以 `expandedGraphSha256` 入锁（计入 promptRef 目标与门禁名），续跑重算不符即拒——"换客户端接着跑"从此有可比对量。
- 档位与场景是两件事：`scenario` 不得用来绕档位，未写档位仍是草稿档；档位可见靠 `execution.rigorSource` 与 claim 字段，  **不改任何流程的提示词字节**。
- 词汇与机判口径的唯一权威表述：`invocation-adapters-spec.md` §11；本轮执行账：`versions/平台接入清单.md` §8.22。

## 2026-09-23 状态更正（3.1.0 采纳与整理）

3.1.0 发布后的共享指针已完成切换，codex、workbuddy、zcode、qoder、doubao 的配置面已对齐；dsh 保持未接入。归档与逐文件哈希清单位于 `inbox/archive/20260923-optimization/MANIFEST.json`，收口证据位于 qoder 维护目录。历史发布目录没有被覆盖。
