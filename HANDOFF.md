# E:\ai 总框架



> 更新：2026-09-18。本文保留 **上位基本原则（BP-1~BP-7，其中 **BP-6 入库先行** 与 **BP-7 不可入库件隔离与备份** 于 2026-09-21 新增（指令 09-20 深夜））+ 三共享仓（tool / agent / software）+ 各运行平台** 的总框架。各运行平台的本章由该平台自己维护，这里只放相对路径。inbox 与 `ai学习笔记` 不在本文展开。zcode 于 2026-09-17 重建：矩阵仍 38/2/0，但脚本沙箱 / peer / MCP 未恢复。**数模自 2026-09-22 起不再有专属链路**（用户裁决，见 `versions/架构基本原则.md` §9 第 11 条）：`math-solver-chain` 不再是各平台需声明的能力项，「交稿须转某平台」的跨平台特例作废，数模与其它 agentic workflow 等同；其环境需求按 BP-1 §1.6 三选一归属。



## 一、总述



**上位基本原则 BP-1 ~ BP-5**（全文与判据：[架构基本原则.md](versions/架构基本原则.md)；本文件任何条款与它冲突以它为准）：



| | 一句话 |

|---|---|

| **BP-1 三仓骨架不可变** | `tool`+`agent`+`software` 三共享仓的存在、职责与**同构形态**（指针 / 版本目录 / `SHA256SUMS` / 钉版 / 一句话切换）不得被取消、合并、降级或绕过；只放可冻结可共享的文本，本体/凭据/产物不入仓 |

| **BP-2 平台对等** | 已接入平台一律对等，能力并集从三仓 registry 集中算一次、逐字相同；**接入完成 = 对全目录能力 0 `declaredAbsent`**；作者/定稿身份无运行时特权；差异只能是时间差，不得写成主/次平台分层；共享代码禁平台专有常量；结论不互抄 |

| **BP-3 验收与接入最小量** | 三仓为共享而存在：除必要时间与 token 外验收/接入一律最小量（风险比例 / 哈希增量 / 单条 `conform` 出 digest / 只留能抓真失败的检查 / 全矩阵只在首次接入与大版本升级）；复用已声明 Profile 的新资源零平台改动 + 单格冒烟；新增验收先过三问 |
| **BP-4 跨平台同一项目语义** | 一项目拆多 run 跨平台跑必须等价于同平台连续跑；**两项**必需机制（2026-09-22 基本原则 1.3 由三项裁减为两项）——**续跑版本一致性校验**（不得静默换版）、**可回读的带 sha256 交接载体**（`handoff-bundle/v1` 或用户指定共享路径，不得直读别平台 `runtime/`）。~~跨平台资源仲裁~~、~~平台中立项目状态层目录~~、~~并行是一等能力~~ 三项**已撤销为必需项**（撤销 ≠ 修好；已实现的 3.0 网关锁表等作用域如实声明为**同一平台内**）。进行中单 run 不热迁移（设计边界）。代价明写：同一项目被两个客户端同时开工不会被任何机制发现，两边会互相覆盖 |
| **BP-5 分步实施与完成判定** | 进入执行的方案必须先给 **P 步表**（每个 P 约 2–3 小时、内含 2–4 个带可中断点的子块，切块理由是**人的作息**而非任务的逻辑边界）；批准后严格照案执行，**非阻断缺陷只登记不当场修**，收口后统一另出一份修复方案；**P 表按其预定判据跑完即＝更新完成**，不得追加验收项、不得改判据、不得出现"跑完了还不算完成"（等待型观察项归完成后的维护期）；完成＝判据满足 + 既有产物可回读，红线不因本条削减 |

| **BP-6 入库先行** | 任何架构更新 / 平台接入 / 发布 / 修复，在宣布完成前必须把治理文本与平台配置面提交进根仓 git，且**破坏性动作之前先有可回滚 commit**；推送前过凭据 / 本体 / 大文件扫描，禁止强推；收口报告必带四项读数（HEAD sha、白名单内 `git status` 为空、远端与本地一致、入库早于破坏）。没有入库读数的「完成」按谎报处理 |
| **BP-7 不可入库件隔离与备份** | 进不了 git 的东西（venv、密封脚本环境、软件本体、真机数据目录、大缓存）必须①按平台隔离在 `<platform>/runtime/`（共享件不得出现其绝对路径）；②在 `inbox/backup/<platform>/` 留登记（可重建件交"重建配方 + 逐文件 sha256 + 一条重建命令"，不可重建件留完整副本，含凭据者显式标注且不出库）；③**经一次真实恢复演练才算备份**，没演练过的按未备份处理 |


**BP-4 与"产物归平台"的划界（2026-09-22 修订）**：归平台 = 配置、凭据、缓存、日志、run 私有一手证据、本体安装位、**网关的平台内锁表**；必须可跨平台读回（经带 sha256 的交接载体，不直读别平台 `runtime/`）= 续跑所需的项目可写状态、跨 run 版本锁、已完成阶段的结论与产物摘要。



正式一级目录：`codex`、`dsh`、`workbuddy`、`zcode`、`doubao`、`tool`、`agent`、`software`、`inbox`、`qoder`、`versions`、`.zcode`（另含 2026-09-22 设立的 `docs-site` 与 2026-09-27 登记的 `architecture-manager`；**`ai学习笔记` 已于 2026-09-29 由用户迁入 `inbox/ai学习笔记/`，不再作为根级一级目录**），其中 `versions` 为架构版本文档区，当前基线 **`架构3.0.0.md`**（2026-09-21 定稿；其「只登记框架侧 + qoder 一个平台」的口径已被同日 codex、workbuddy 的采纳超出，三家读数在 `平台接入清单.md` §8.18–§8.19 与 `架构3.0.0-文件地图.md` 表 B；判据载体 `架构3.0.0-定稿实施表-20260920.md`，框架侧账在 §8.17），其下 **`架构2.0.0.md`**（2026-09-18 定稿，配套迁移指南与恢复手册；**§9 平台表与 §10 归属表仍是各平台状态的现行载体**），`架构1.0.0.md` 为冻结历史基线；`.zcode` 为 ZCode 客户端工作区级配置目录，2026-09-14 登记：只放命令/技能副本，不放运行输出与凭据）。不得擅自新增一级目录。



**运行平台（6 个目录，相互隔离）**：`codex`、`dsh`、`workbuddy`、`zcode`、`qoder`、`doubao`——其中 **5 个已按规范 §8/§9 完成接入验收**（`codex`/`zcode`/`qoder`/`doubao`/`workbuddy`，各自矩阵均为 **38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL**），**`dsh` 尚未接入**（其平台章自述「用户此前暂缓本平台；未验证前不得写成已接入 runner」）。配置、凭据、缓存、日志、运行输出只写本平台目录；不得改另一平台。`qoder` 于 2026-09-15 升格：按规范 §9 八项接入、以 `ops/invocation_matrix.py` **FAIL 0** 为判据（当前 r5：`38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`，r4 同数），钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`，已自建 WSL2 钉版脚本环境并声明 `profiles.renderer`。`doubao` 于 2026-09-16 升格（用户授权）：按规范 §9 八项接入、矩阵 r1 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`，钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`，平台自建 Windows venv（`doubao/runtime/py-env`）并声明 `profiles.renderer`；无脚本隔离环境（script 阶段不可执行）。`workbuddy` 于 2026-09-16 升格（用户授权）：按规范 §9 八项接入、矩阵 r3 `38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`（因会话沙箱子进程总量限制按 `--only` 分 38 片执行后机械合并，provenance 留档），钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`，平台自建 Windows venv（`workbuddy/runtime/py-env`）并声明 `profiles.renderer`；入口 `/wf` `/wfa` 用户级 Skill + CLI 直调；无脚本隔离环境（script 阶段不可执行）。



**架构 2.0 增量（2026-09-18 定稿，详表见 `versions/架构2.0.0.md`）**：上面各平台的矩阵读数（`38 / 0 / 2 / 0` 一类）都是 **1.0 判据面**，描述的是"按 `prepare→next→stop` 可调用"，不代表该平台已具备 2.0 面。2.0 新增引擎配置键 `executionBackend` / `scannerRelease` / `projectWriteRoots` / `peerDispatcherModule`、独立契约包 `runtime-contracts 1.1.0`、`ai-platform-descriptor/v2` 分面预检与入口版本可省略/`current`。**截至定稿时点，只有 `qoder` 把 2.0 栈接进了生产**（`wf-runner 0.7.6`，14 份 / 219 项机检；**09-18 晚 2.0-D 框架闭合发布 `0.7.7`；09-19 zcode 生产切 0.7.7 栈（清单 §8.8，电池全绿、窗口 10:31 起算）；qoder 生产接入面 09-19 灭失 → 2.0-F 从 transcript 还原配置面 → **2.0-G 已重出证**（清单 §8.12：jail 边界 25/25、门1 真 script 阶段到 `succeeded`、门2 两条失败关闭 + conform 9/9、矩阵 `PASS 38 / NEEDS-INPUT 1 / EXPECTED 0 / FAIL 0`；**门3/门4 的 qoder 列仍待补**，登记 D-21；09-18 那批 baseline 一手件仍永久不可回读）**；其余已接入平台生产仍 `0.6.0`、未自证 2.0 面）——**不得替任何平台申报 2.0 能力，各平台按自己的目录自己出证**（peer/委派结论尤其不可互抄）。两条口径已改判：`repo-lint` 那格从"平台能力缺口"变为**版本对齐例外**（缺口本身在 D04 只读绑定下已闭合），`C5` 并发用例已实测但结论只到「无撕裂 + 争用即拒」。定稿属**带偏差定稿**（zcode pilot→生产、两平台合表、48h 观察窗口未完成），逐条见 2.0.0 §10。



**〔2026-09-19 2.0-H 框架收口轮〕** 按 BP-5 把 2.0 的账分成**框架**与**平台**两类判：框架侧（三仓发布形态、引擎与契约字节、判据工具、文档自洽）在 `versions/架构2.0.x-框架收口与修复方案.md` 的 F-P1…F-P3 与 X-P1…X-P6 跑完时收口；平台侧（各平台生产接入、四门逐平台出证、能力地板到 0 `declaredAbsent`、48h 观察窗口）**一律移交各平台自己出证，结论不互抄**（BP-2 §2.6），本轮不代为宣布任何一项满足。逐条归属见 `versions/架构2.0.0.md` §10.0 与 §13；本轮新登记 D-22～D-26（含"门3/门4 的驱动脚本仍在盘上、缺的只有 fixture 与 baseline 产物"这一实测成本更正）。



**〔同日 2.0-X 修复轮已执行〕** 框架侧欠账按 `versions/架构2.0.x-框架收口与修复方案.md` 的 X-P1…X-P6 跑完：发布 **`wf-runner 0.7.9`**（D-15 协议交付固定 UTF-8 / D-16 交付失败不再伪装成入参不合 / D-12 可分类半）、`architecture-ops 1.1.0`（判据 harness 首次成为共享版本件，D-10 组）、`platform-conformance 1.1.0`（CON-04 逐字回读 `evidenceBindings`，D-11；`-t .` 运行命令，D-20）；共享 current 现值 `wf-runner 0.7.9` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0` / 两个治理包 `1.1.0`。qoder 生产仍自钉 0.7.7。台账 `qoder/runtime/maintenance/2.0-X/`，账见清单 §8.14。



**〔2026-09-20 架构 2.1.0 框架侧执行轮（2.1-A）〕** 按 `versions/架构2.1.0-定稿实施表-20260919.md` 的 P1…P9 逐行跑完（框架侧）。发布三件，全部新目录、零改写已发布字节：**`wf-runner 0.8.0`**（A 轴三档 `rigor`：门禁执行 / seal 文档 / 往返次数按档增减，**功能面三档一视同仁**；每 run 一次权威环境哈希 + 之后增量复用，实测 7 100 文件全量 87.8 s → 增量 23.6 s、比值 0.269 ≤ 1/3；§3.2 脚本执行降级阶梯 `kernel-sandbox → platform-venv → host-controlled`，其中主机一档**必须本次请求自带用户同意**且同意摘要进锁；BP-4 三机制：平台中立 `handoff-bundle/v1` 交接包、续跑版本一致性**不一致即拒绝、不得静默换版**、exclusive 资源仲裁键同键互斥且被拒者零落盘）、**`runtime-contracts 1.2.2`**（`ai-run-lock/v1.2` 的 `execution.rigor/gated/frozen/execPath/hostConsent`、"无密封环境"的合法锁形态、`handoff-bundle/v1`；`state` 规则 2 只做**收窄式**例外，普通 run 的"prepared ⇒ completed 必空"一字未动）、**`platform-conformance 1.2.0`**（一条 `conform` 命令集中算三仓能力并集，出 pass / `declaredAbsent` / 未测 三类清单 + 两个摘要，每条缺口必须带补齐路径与**整数分钟**成本，报告内不得出现"本平台不支持"措辞）。**D-27 自此两面闭合**（契约半 1.2.0、语义半 0.8.0：声明不出密封脚本环境的平台，提示词面照常跑到 `succeeded`，脚本面回答结构化 `CAPABILITY_UNAVAILABLE` 且不留半截产物）。**发布 ≠ 采纳**：共享 `current` 全部未翻（`wf-runner 0.7.9` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0` / 两个治理包 `1.1.0`），**qoder 生产仍显式钉 `0.7.7`**；在发布字节上复跑受影响电池并跑一次 39 格全矩阵 `FAIL 0`（`PASS 38 / NEEDS-INPUT 1 / EXPECTED 0`，784.5 s）。**采纳 0.8.0 的平台必须在自己 config 里声明 `scriptEnvironmentRungs`**（P6 阶梯的入口）：只带旧单键 `executionBackend` 的配置，脚本派发会 fail-closed 而不是静默沿用——这是本轮实测到的迁移要求，本平台生产因仍钉 0.7.7 未受影响。仍未完成的都是平台侧：其余五平台各自采纳与自证（结论不互抄）、48 h 等待型观察窗口、P8b 跨平台续跑演练与中立层目录落点的单独授权（`qoder/runtime/maintenance/2.1-A/HANDOFF-P8b.md`）。台账 `qoder/runtime/maintenance/2.1-A/2.1-LEDGER.md`，账见清单 §8.15。



**不是运行平台**：`inbox`（待整理，不自动执行；`ai学习笔记` 自 2026-09-29 起作为用户内容区位于 `inbox/ai学习笔记/`）；`versions`（架构版本文档区）。`claude code` 仍仅登记。



**共享仓库**：`tool` = 工作流，`agent` = 专家，`software` = 软件配方（架构 3.0，2026-09-18 设立，存配方不存本体；**2026-09-21 起三仓同构判据在 `software` 上闭合**）。已发布版本只读，不覆盖旧目录。运行开始时把版本写入本平台 `runtime/runs/<run-id>/run-lock.json`。专家内部服从 `tool-lock`。**〔3.0.0 采纳状态（qoder 实测，不代他平台申报）〕**：本轮发布六件（`wf-runner 0.9.0` / `repo-lint 0.4.0` / `runtime-contracts 1.3.0` / `platform-conformance 1.3.0` / `architecture-ops 1.2.0` / `software/_gateway 1.0.0`），**共享 `current` 一处未翻、qoder 生产仍钉 `wf-runner 0.7.7` 且 config 不声明 software 键**——发布 ≠ 采纳；采纳是各平台自己的动作且需配对（`0.9.0` 的 `software-call` 依赖 `repo-lint 0.4.0` 词汇，且 `tool/repo-lint` 抬针必须与该平台 `scannerRelease` 同批，见清单 §8.17 的 D-52）。



调用 `math-modeling-programmer`（直调或经专家）时六平台同一档位，细则见 [invocation-adapters-spec.md](invocation-adapters-spec.md) §3.1：



| 档位 | 含义 |

|---|---|

| **草稿**（未写档位） | 只做点名范围；不 INIT 已有项目、不重跑求解器、不扫参、不独立验证、不过严图、不冻结 |

| **过图** | 草稿 + 非严格 QA |

| **交稿** | 该问所需阶段并冻结 |



非交稿不得称为已验证或已冻结。禁止用 runner INIT 清空已有项目。



规则与红线：[AGENTS.md](AGENTS.md)、[AI_ARCHITECTURE_SYSTEM_PROMPT.md](AI_ARCHITECTURE_SYSTEM_PROMPT.md)。实施状态：[agentic-workflow-master-manual.md](agentic-workflow-master-manual.md)。门禁与收口记录：[post-competition-closeout.md](post-competition-closeout.md)（G1/G2/G3 已于 2026-09-14 全部闭合）。



## 二、tool、agent 与 software



| 仓库 | 注册表 | 说明 |

|---|---|---|

| 工作流 | [tool/registry.json](tool/registry.json) | 每项看该目录 `current.json` 与 `versions/` |

| 专家 | [agent/registry.json](agent/registry.json) | 同上；内部工作流以 `tool-lock.json` 为准 |

| 软件配方 | [software/README.md](software/README.md) | 架构 3.0 第三仓库；存 manifest/能力快照/schema/recipe/selftest/说明书，**不存软件本体**；2026-09-21 起与另两仓同构到位：`software/registry.json` + 逐配方 `current.json` + `versions/` + 双向 `SHA256SUMS` + `SOURCE.json`，并新增 **`software/_gateway/1.0.0`**（参考软件网关首版，共享程序件，故**不进 registry**，由平台 `config.softwareGateway` 指向释放版字节）；首批 6 个配方（nmap/wireshark-cli/burp-suite/dirsearch/veracrypt/mysql-cli）见清单 §8.17，其能力快照**全部未冻结**（D-47）⇒ 软件调用面按 `CAPABILITY_UNAVAILABLE` 答，不报漂移、不假绿 |



**共享 current 的当前状态（2026-09-15 实测；**09-19 两次切换：先 `wf-runner 0.7.8` / `repo-lint 0.3.0` / `runtime-contracts 1.1.0`（清单 §8.9/§8.10），同日 2.0-X 修复轮再切到 `wf-runner 0.7.9` 并把两个治理包升到 `1.1.0`（清单 §8.14）——下列为历史快照**）：数模工作流 `1.7.2` / 数模专家 `1.9.0`；`game-sprint-plan 2.1.1`；`visualization-qa 1.2.1`；`game-builder 1.8.0`；`novel-writer` / `software-engineer` / `security-researcher 1.4.0`；`visualization-engineer 1.6.0`；`expert-task 1.1.0`；`repo-lint 0.2.1`；`wf-runner` 指针 `0.5.2`（平台另选 `0.6.0`，两套机制不同）；mastermind 父工作流 2.0.0 / 父专家 3.5.0 / 六个子专家 1.1.0。全系统锁滞后 0。架构基线与终检见 `versions\架构1.0.0.md` 与 `zcode\runtime\runs\20260914-u3-repo-lint-020\reports\s4-closeout-ledger.json`。



**历史（2026-09-13，两批共 16 项）**：当时为 runner 0.5.2；数模工作流 1.6.0 / 专家 1.7.0；game-sprint-plan 2.1.0；visualization-qa 1.2.0；game-builder 1.5.0；visualization-engineer 1.5.0。每批含回滚演练（逐字节还原）与切换后核验（repo-lint errors=0、MCP 列表、默认解析冒烟）。证据：`zcode\runtime\runs\20260913-postcomp-10|11\reports\`（合并记录 `…postcomp-11\reports\session-summary.md`）。平台本地覆盖不得改共享 `current`。



2026-09-13 增补：`tool/mastermind-peer-task` 为新增工作流资源（子专家通用管道），已登记 `tool/registry.json` 并切默认 1.0.0。



2026-09-13 增补：`tool/repo-lint/versions/0.1.2` 由 qoder 会话按用户授权发布为**新增版本目录**（唯一改动 = runtime `protocol` / `run-lock` / `transaction` 三处 platform 枚举加入 `qoder`）。`0.1.1` 目录逐哈希未变（该段为 2026-09-13 的历史记录）；**当前** `repo-lint/current.json` 已是 `0.2.1`（2026-09-14 升至 0.2.0、2026-09-15 随架构 1.0.0 升至 0.2.1），qoder 与 zcode 平台均已钉 `0.2.1`（qoder 于 2026-09-15 从自钉的 `0.1.2` 改齐，`0.1.2` 退役为历史留档、不删除也不再被钉用；平台自决，互不影响）。发布检查点与回滚入口：`qoder/runtime/maintenance/repo-lint-0.1.2-publish-checkpoint.json`。



## 三、运行平台（各平台一章）



只准该平台会话改自己的文件。本章若与总框架冲突，以总框架与 [AGENTS.md](AGENTS.md) 为准。



| 平台 | 本章（相对路径） |

|---|---|

| Codex | [codex/bridge/platform.md](codex/bridge/platform.md) |

| DSH | [dsh/bridge/platform.md](dsh/bridge/platform.md) |

| WorkBuddy | [workbuddy/bridge/platform.md](workbuddy/bridge/platform.md) |

| ZCode | [zcode/bridge/platform.md](zcode/bridge/platform.md) |

| Qoder | [qoder/bridge/platform.md](qoder/bridge/platform.md) |

| Doubao | [doubao/bridge/platform.md](doubao/bridge/platform.md) |



`doubao`（2026-09-16 升格为第 6 运行平台，由本平台会话维护自己的章）：接入判据为矩阵 r1 **`38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`**（`doubao/runtime/matrix-smoke/doubao-matrix-20260916-r1.json`），钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`；`permissionAdapters`（业务三元组）与 `profiles.renderer`（matplotlib 3.9.4 平台内出图实测）均已声明；真实提交闭环（game-sprint-plan 三阶段 submit）、专家调用（novel-writer 经 tool-lock 解析主工作流）、并发独立性（C1/C2 两 run 并行）均已实测。**能力边界**：无脚本隔离环境 → 协议内 `action: script` 阶段与图表工具不可执行、peer 委派未声明不可用；数模求解器链不承接。〔2026-09-22 裁决后历史化：数模与其它 agentic workflow 等同，math-solver-chain 不再是能力项，"交稿须转某平台"作废——现状读 versions/平台接入清单.md §8.29/§8.30〕 交稿级须先确认目标平台已声明并验证 `math-solver-chain`（**不要默认转 zcode**：zcode 2026-09-17 重建后该项为 `declaredAbsent`）。例外同其他已接入平台（`wf-runner` 设计、`repo-lint` 策略不可兑现），登记在 `doubao/bridge/invocation-exceptions.json`。其他会话不要重复盘点。



`workbuddy`（2026-09-16 升格为第 7 运行平台，由本平台会话维护自己的章）：接入判据为矩阵 r3 **`38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`**（`workbuddy/runtime/matrix-smoke/workbuddy-matrix-20260916-r3.json`；因会话沙箱对单条命令子进程总量的限制，整版矩阵两次被终止（r1@20/r2@24 留证），按 `--only` 分 38 片执行后机械合并，provenance 随报告留档），钉 `wf-runner 0.6.0` + `repo-lint 0.2.1`；`permissionAdapters`（业务三元组）与 `profiles.renderer`（matplotlib 3.9.4 平台内出图实测）均已声明；真实提交闭环（game-sprint-plan 三阶段 submit）、专家调用（novel-writer 经 tool-lock 解析 expert-task）、并发独立性（C1/C2 交错并行）、check_follow 零漂移与换代五步演练均已实测；`/wf` `/wfa` 已装入用户级技能面 `<local-user-path> → 协议内 `action: script` 阶段与图表工具不可执行、peer 委派未声明不可用；数模求解器链不承接。〔2026-09-22 裁决后历史化：数模与其它 agentic workflow 等同，math-solver-chain 不再是能力项——现状读 versions/平台接入清单.md §8.29/§8.30〕 交稿级须先确认目标平台已声明并验证 `math-solver-chain`（**不要默认转 zcode**）。例外同其他已接入平台（`wf-runner` 设计、`repo-lint` 策略不可兑现），登记在 `workbuddy/bridge/invocation-exceptions.json`。其他会话不要重复盘点。



`qoder`（2026-09-15 升格为运行平台，由本平台会话维护自己的章；**2026-09-19 生产接入面灭失 → 2.0-F 还原配置面 → 2.0-G 重出证**：0.7.7 栈 + venv 形态密封环境（2545 件）+ jail 25/25 + 门1 到 `succeeded` + 门2 两条失败关闭 + conform 9/9 + 矩阵 `PASS 38 / NEEDS-INPUT 1 / EXPECTED 0 / FAIL 0`（清单 §8.12）。本段下述 09-18 的读数中，凡指向 `2.0-B..2.0-E/baseline/` 的一手件仍**不可回读**（D-2），只作文档转述；门3/门4 的 qoder 列本轮未排产、记为待补（D-21），共享 current 当时为 0.7.8/0.3.0/1.1.0（同日 2.0-X 起为 **0.7.9**/0.3.0/1.1.0，2.1-A 发布 0.8.0 后指针仍未翻）而 qoder 自钉 0.7.7）：1.0 判据矩阵 **`38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL`**（`qoder/runtime/matrix-smoke/qoder-matrix-20260915-r5.json`，r1–r4 留档）；**2026-09-18 起生产接 2.0 栈：`wf-runner 0.7.7`（16:51 先接 0.7.6，约 23:00 按 2.0-D 切 0.7.7，观察窗口重新起算） + `runtime-contracts 1.1.0` + `scannerRelease repo-lint 0.3.0` + `executionBackend` + `projectWriteRoots` + peer 两键，14 份 / 219 项机检全绿**（`qoder/runtime/maintenance/2.0-C/`；共享 current 仍 0.5.2，选版与指针两套机制）。`permissionAdapters` 与 `profiles.renderer` 均已声明；`submit`、幂等回放、修订守卫、并发单写者、共享默认换代跟随、入口 `/wf` `/wfa`（已装进 Qoder 用户级 `~/.qoder/skills/` 并在会话内装载验证）与 WSL2 隔离脚本环境（jail 内 matplotlib/Agg 真实出图）都已实测。**两条原例外已按实况改判**：① `repo-lint` 的 `shared-read-only-platform-report-write` 原先记为"任何平台都兑现不了"，在 2.0 的 `executionBackend + sharedReadOnlyBinds` 注入路径下**已闭合**（用户单独授予本平台 D04 只读绑定，`0.3.0` live 扫描真过 `/wf` 到 succeeded），剩下的 `0.2.1` 那格改为**版本对齐例外**；② 协议内 `action: script` 阶段已真跑到终态，不再是未实测格。**仍未实测**：`process` 门禁、崩溃恢复、figure 工具的 `--execute` 一格；数模按实测划界：**图 QA / 渲染 / PDF 审计链本平台承接，求解器链不承接**（scipy/pandas 等超出引擎每次执行全量重算哈希的 120s 预算，且本平台无九阶段演练）。〔2026-09-22 裁决后历史化：数模与其它 agentic workflow 等同，math-solver-chain 不再是能力项——现状读 versions/平台接入清单.md §8.29/§8.30〕 交稿级须先确认目标平台已声明并验证 `math-solver-chain`（**不要默认转 zcode**）。其他会话不要重复盘点。  **〔2026-09-21 已采纳架构 3.0.0〕** 生产切 `wf-runner 0.9.0` + `runtime-contracts 1.3.0` + `scannerRelease repo-lint/0.4.0`（一批，半切换必被拒）、三根只读绑定、七件 software 键与 `kernel-sandbox` 阶梯；密封脚本环境重建并重新出证；三份配方快照按真本体只读实测冻结（发 1.0.1），软件矩阵行首现真绿；能力地板 `pass 26 / declaredAbsent 1 / unverified 0`，剩的 `profile:administrator` 有意保留；生产 config 下 45 格矩阵 `FAIL 0`；**共享默认一处未翻**。账在清单 §8.18，章在 `qoder/bridge/platform.md`，判据在 `versions/qoder接入3.0.0-实施表-20260921.md`。



`zcode`（已接入；**2026-09-17 重建**，由本平台会话维护自己的章）：**2026-09-19 生产切 `wf-runner 0.7.7` 栈**（`contracts=runtime-contracts/1.1.0` + `scannerRelease=repo-lint/0.3.0` + `executionBackend` + peer 双键 + 平台默认 repo-lint 0.3.0；受影响面电池全绿、观察窗口 10:31 起算，见 `zcode/runtime/maintenance/2.0-prod-adoption/`；`projectWriteRoots` 未声明，登记待补）；1.0 判据矩阵仍 **`38 PASS / 2 EXPECTED / 0 FAIL`**（`zcode/runtime/matrix-smoke/reconnect-final.json`）。能力以 `zcode/bridge/capabilities.json` 为准：prompt 与 renderer 自测已恢复，script 环境与 peer 生产面已实证；**`declaredAbsent`** = MCP / 数模求解链。9-13 的 G3、ZP-7 九阶段**不继承**。平台章：`zcode/bridge/platform.md`。



## 四、各平台改自己的章时必须遵守



1. 不改 `tool/`、`agent/` 已发布版本，不改共享 `current.json`。

2. 不改其他平台目录。

3. 数模未写档位 = 草稿；本平台入口（命令 / Skill / MCP）由本平台会话接到该规则。

4. 能力未在本平台验证的，不得写成已接入。

5. **（BP-2）** 能力缺位写 `declaredAbsent` + 待补路径与成本，**不得**写成"主/次平台"分层或"本平台不支持"的永久章；作者/定稿身份不产生运行时特权；他平台结论不可引用为本平台已闭合。

6. **（BP-1）** 三仓对称：本平台若只接了 `tool`+`agent`，`software` 那根属**接入未完成**并计入待补台账，不得写成设计如此。

7. **（BP-3）** 新增单个 tool/agent/配方只做增量索引 + 单格冒烟；不得顺手重跑全矩阵或重认证未变能力。全矩阵只属于首次接入与引擎/契约大版本升级。

8. **（BP-4，2026-09-22 修订）** 跨平台续跑经带 sha256 的交接载体（`handoff-bundle/v1` 或用户指定共享路径），**不得**直读别平台 `runtime/`；前后钉版不一致必须警告或拒绝，不得静默换版。**并行与跨平台互斥已不再是必需项**（原「互斥键须在所有平台间有效」「并行是一等能力」两项撤销）：单平台内锁表即正确形态，但必须如实声明作用域只在平台内——同一项目被两个客户端同时开工不会被发现，会互相覆盖。

9. **（BP-5）** 任何平台侧的更新 / 接入 / 修复方案进入执行前必须给出**有序 P 步表**（每个 P 约 2–3 小时、内含 2–4 个子块、每个子块有可中断点与可回读产出物；切块理由是人的作息而非任务的逻辑边界）；批准后照案执行，执行期的**非阻断缺陷只登记不当场修**，本轮收口后统一另出一份修复方案（另立 P 表）；**P 表按其预定判据跑完即视为该次更新完成**，不得追加验收项、不得提高判据、不得写"跑完了还不算完成"（等待型观察项属完成后的维护期）。



## 〔2026-09-22〕状态更正（3.0-R2 纯文档轮）



**〔2026-09-22 状态更正，见 `versions/平台接入清单.md` §8.19–§8.20〕** 三件事在本文旧措辞之外发生了变化：① **3.0 的采纳不止 qoder 一家**——codex（提交 `6f757bfa`）与 workbuddy（提交 `002f1eee`）已于 09-21 各自采纳 `wf-runner 0.9.0` + `runtime-contracts 1.3.0` + `repo-lint 0.4.0` 并出自家读数，三家深度不同（只有 qoder 冻结了快照、地板到 `26/1/0`；codex 缺 `softwareProfiles` / `softwareConsentGrants` 且六快照全未冻结；workbuddy 软件面仍是叙述块、无脚本沙箱），**结论不互抄**；zcode（0.7.7）、doubao（0.6.0）未接，dsh 未接入。② **BP-4 已于 09-22 修订**（基本原则 1.3）：不再强硬要求多平台并行，"跨平台资源仲裁 / 中立项目状态层目录 / 并行编排模板"三项**撤销为必需项**，续跑只需两项机制（版本一致性校验 + 带 sha256 的交接载体）；据此 `3.0.0.md` §5 / §10 与 `2.1-A/HANDOFF-P8b.md` 里的"跨平台仲裁未满足、需单独授权"从待补项改为**已裁减**，代价明写在条文里（同一项目被两客户端同时开工不会被发现、会互相覆盖）。③ **数模不再有专属链路**（红线 6 通用化 + 新增 BP-1 §1.6 环境归属三条路）：`math-solver-chain` 不再是各平台需声明的能力项，"交稿须转某平台"作废；本轮另登记用户对 `software` 仓的目标形态——**经连接器 / MCP 链接调用**（只登记方向，不改 3.0 字节与判据）。另：48 h 观察窗口按算术为 **09-23 15:0x(+08)** 满窗，09-22 本轮尚未走完（按 BP-5 §5.6 它从来不是完成的先决条件）。



④ **同日夜里追加（3.1.0 提案 v2）**：用户授权把 **9 条已登记欠账并入 3.1.0 那张表**（D-32 / D-34 / D-51 / D-53 / D-56 / D-59 / D-62 / D-64 / D-66，见 `versions/架构3.1.0-更新方案-20260920.md` §7.1 与 `versions/平台接入清单.md` §8.21）⇒ 框架侧 **9 步 22.5 h → 10 步 24.5 h**（新增一步 T-P3b，与 F-1 / F-2 **同一代**引擎字节，禁止拆成补丁版），裁定项 8 → 10（新增 C-9「并入不算向 3.0 判据加码——加码禁期在定稿之后」、C-10「收口按新代字节跑一次 45 格全矩阵，各域迁移不触矩阵」）。同一轮把提案对齐到基本原则 1.3：**取消**其 §5 的"场景级并行编排模板"产出与"依赖中立项目状态层"声明，续跑判据改为**跨客户端续跑演练**。**C-1…C-10 已于同夜全部裁完**（C-4 与 C-6 依当晚盘上实测**推翻原建议口径**：skill 释放件真实形态是 `SKILL.md`+`manifest.json`+`SOURCE.json`+`SHA256SUMS`；registry 无 `deprecated` 位而 `enabled:false` 会切断旧 run 解析）⇒ 提案进入「**可定稿**」，并新增两条契约后果 `requiredStages` 与 `deprecated`/`supersededBy`（新登记 D-69）。**仍是提案**：T-P1…T-P10 未获批准 ⇒ 零实施授权；本轮零新代字节、零指针切换、零 run。


⑤ **09-23 白天续跑并收口（3.1-A）**：T-P1…T-P9 十步全部跑完，基线 `versions/架构3.1.0.md` 成稿。同代发布 `wf-runner 0.10.0` + `runtime-contracts 1.4.0` + `repo-lint 0.5.1` + `architecture-ops 1.3.0` + `platform-conformance 1.4.0`（**五处 `current` 一字未翻**）；三域内容收拢落地（security 7→1、game 12→1 且 `game-sprint-plan` 保留独立、novel/se/viz 各 4 场景）。总账与红线核对见 `versions/平台接入清单.md` §8.22，逐格读数见 `qoder/runtime/maintenance/3.1-A/3.1-LEDGER.md`。仍开放的都在"采纳"一侧：各平台各自切代自证（本平台生产切代需用户授权）、T-P3b 九格端到端需在平台实盘跑、`_gateway 1.0.1` 与软件面连接器/MCP 方向另案。

## 2026-09-23 整理与采纳更正

3.1.0 框架已完成后，本轮完成共享 tool/agent 指针切换、五个平台 bridge 配置对齐和归档。此前文档中的“指针未翻”属于 09-23 之前的历史快照；当前版本、归档清单、验证限制以 `versions/平台接入清单.md` §8.23 和 `qoder/runtime/maintenance/20260923-optimization/FINAL.md` 为准。dsh 仍未接入。

## 五、目录维护约定（2026-09-30 整理增补）

本节为 2026-09-30 全目录整理（冻结点 `266cb2c7`）后固化的目录治理条文，与 `AGENTS.md` 同文；任何平台会话整理目录时都必须遵守。

1. **治理文本不指向 inbox 现行件**：根级文档、`versions/`、三仓 README、各平台 `bridge/` 不得把 `inbox/` 内对象当作现行依赖或配套入口引用。`inbox/archive/` 的历史指针只允许「跳转页 / 证据登记」形态（只说明"原物已归档、去哪查"，不要求回读原物）；`inbox/trash/` 内对象不得被任何治理文本引用，入 trash 前必须先摘除引用。
2. **项目结束即归档**：各平台 `workspaces/` 只放活跃项目；赛后或已完结项目入 `inbox/archive/<日期-主题>/`，形态为压缩包 + `MANIFEST.md` + 逐文件 `SHA256SUMS`；必须解压到临时目录逐文件复算哈希全部一致、无多余无缺失后，才允许删除未压缩原件。
3. **各归其位**：备份只入 `inbox/backup/<platform>/`；临时件只入 `<platform>/runtime/tmp/`；根目录不落地临时文件；平台缓存入各平台 `runtime/` 下既有缓存目录，清空缓存保留目录本身。
4. **移动即改引用**：任何移动先全量查引用（治理文本 + bridge / runner 配置 + 注册表），移动与引用修订同批完成；同盘移动后核对文件数与字节数，跨盘移动逐文件哈希。配置面引用的目录（如 runner 解释器指向的 `.venv`）不得按目录名推断归属，必须先解引用再决定动不动。
5. **一级目录白名单**：新增一级目录须用户授权，并同步 AGENTS.md / 系统提示词 / HANDOFF 三处清单；白名单外的根级新增文件一律视为越界。
6. **删除分级**：零风险死文件（过期安装暂存、缓存、空壳、临时文件、升级残留）可在证据（时间戳、进程不依赖、正式版完好）齐备后直接清理；入 `trash/` 的对象与大体积批次必须逐批列清单、逐批授权后才物理删除；已发布版本、bridge、凭据、客户端本体、密封环境为红线只读。
7. **已与远端同步的嵌套 Git 仓**：删除本地副本前必须复核工作树 clean 且本地 HEAD 等于远端跟踪分支，留下 remote URL 与 commit sha 登记后才删；未同步或无远端的不得删。
