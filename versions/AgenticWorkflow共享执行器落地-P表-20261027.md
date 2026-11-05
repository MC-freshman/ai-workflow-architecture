# Agentic Workflow 共享执行器落地 — P 表（2026-10-27）

本文件是为「agentic workflow 全平台仍为 prompt-mode、无 executor」这一表述对应的能力缺口，提出的有序实施表。
**本 P 表本身不是实施授权**（AGENTS.md：候选版本、命令和目标能力不是实施授权）。批准后照案执行，不即兴扩范围、不中途改设计。

## 0. 先把任务定义修正到与盘面一致（2026-10-27 只读探针）

之前「无 executor」的说法是**不准确的**。只读探针读数如下，据此把任务重定义。

| 探针读数 | 数值 | 出处 |
| --- | --- | --- |
| `tool` 仓带 `stages` 的 current 工作流 | **48 个** | 遍历 `tool/*/current.json` → `<id>/versions/<v>/workflow.yaml` |
| stage 动作分布 | **prompt 123 / script 1**（共 124） | 同上，逐 stage 统计 `action` |
| 纯 prompt 工作流 | **47 / 48** | 同上 |
| 唯一 script stage 归属 | `wf-runner` 自身 `dispatch` | `tool/wf-runner/versions/0.13.1/workflow.yaml` |
| 编排是否机读 | **是**：`stages` / `dependsOn` / `requiredStages` / `scenarios` / `gates` / `maxIterations` / `onFail: repair` / `outputs` schema 全部机读 | `tool/research-analyst-pipeline/versions/1.1.0/workflow.yaml`（`ai-workflow-definition/v3`） |
| script stage 是否真执行 | **是**：`engine.py` 的 `next()` 走 `elif stage['action'] == 'script'` → 交付 `task['script']={resourceKey, entry, argv, timeoutSeconds}`；CLI `--execute <RUN_ID> --tool …` → `engine.execute_claimed()` | `tool/wf-runner/versions/0.13.1/engine.py`、`cli.py` L97/L174-175 |
| process gate 是否真执行 | **是**：`gateDefinitions` 支持 `"type": "process"`，带 `argv` / `expectExit` / `expectArtifacts` | `research-analyst-pipeline 1.1.0` 的 `work-integrity` |
| 六平台 `scriptEnvironmentRungs` | **全部已声明，均为 1 档** | 逐平台 `bridge/runner-config.json` 等回读（见下表） |

**结论（ executor 的真实缺口，四条）**

1. **执行器已存在**：script stage / software stage / process gate 三类动作由 runner 真执行并落在沙箱内，**不是「无 executor」**。
2. **缺口 A（定义面）**：该产能**几乎没有被任何用户工作流使用**——48 个工作流里只有引擎自己的 1 个 script stage，其余 123 个 stage 全靠模型读 prompt 自律。 ⇒ 「有实现、无采用、无用户工作流证据」。
3. **缺口 B（边界未成文）**：prompt stage 由 host（客户端会话）执行是**设计边界**，不是缺陷；把模型推理循环也吞进共享仓需要把模型访问与凭据放进仓内运行态，违背 BP-1 §1.6 与 BP-2（禁止平台专有常量/发行版特例）。此边界必须成文为「明确不做」，否则会被误读为欠账。
4. **缺口 C（环境阶梯只有一档）**：六平台均为单档 `execPath: kernel-sandbox` + `requiresSealedEnvironment: true`，无 `platform-venv` / `host-controlled` ⇒ 需要宿主依赖（如第三方包）的动作没有降级落点（D-27 已要求此时返回结构化 `CAPABILITY_UNAVAILABLE`、不留半截产物；补齐档位见「明确排除」第 3 条）。

**本任务的目标**：把「有实现未采用」的执行器，变为「≥3 个真实工作流有 script stage / process gate、在 ≥2 个平台跑出机器证据」，并把 prompt-stage 归 host 的边界写成治理文本。

## 0.1 六平台执行通路现状（实测读数）

| 平台 | `scriptEnvironmentRungs` | backend | 备注 |
| --- | --- | --- | --- |
| codex | 1 档 `kernel-sandbox` | （待 P1 回读具体文件） | |
| dsh | 1 档 `kernel-sandbox` | （待 P1 回读） | |
| workbuddy | 1 档 `kernel-sandbox` | `bridge/backends/manager-sealed.json` | sealed 位于 `runtime/manager-environments/4c30aa9c…/sealed` |
| zcode | 1 档 `kernel-sandbox` | `bridge/backends/manager-sealed.json` | sealed `1247c7a9…` |
| qoder | 1 档 `kernel-sandbox` | `bridge/backends/wsl2-ubuntu.json` | WSL2 后端（与其它平台形态不同） |
| doubao | 1 档 `kernel-sandbox` | （待 P1 回读） | |

## 0.2 环境归属（BP-1 §1.6，三选一并写明）

选**第③路（所属 platform 的 `runtime/`）**：所有脚本真执行复用各平台已声明的密封脚本环境（`scriptEnvironment` 所指 sealed 目录），共享仓内**只放依赖锁与 recipe 文本，不放任何真实字节**；不新建根级专用环境。

## 0.3 每条 P 的可执行董事性约束（必须遵守）

- **真·子进程执行不在 agent 会话内判定**：本环境已知 `child_process.spawnSync` 对一切可执行文件一律 EBUSY、Electron GPU 子进程崩溃 ⇒ P3/P4/P5 的**真实 script stage 执行必须由用户在自己的终端跑**（我给出逐字命令），会话内只能做 `--invocation-smoke`（明示 "never executes a task"）与账套回读。任何人不得把「会话内跑不通」记作能力缺口。
- **红线 1**：已发布字节一字不动；一切改动走**新语义化版本目录** + `SHA256SUMS` 复算。
- **BP-3 最小量**：不跑六平台全矩阵（只在首次接入 / 引擎大版本升级两个时刻跑）；本轮只做「试点 + 增量 + 单条 `conform` digest」。
- **BP-5**：非阻断缺陷只登记（现象 / 复现条件 / 影响面 / 初步定位 / 建议处置），收口后统一另出修复方案。

---

## P1 盘点固定与边界成文（约 2–3 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 固定 HEAD 与各平台配置快照（六份 runner-config + 全部 backend + sealed 路径存在性与 sha256）；把 §0 / §0.1 的探针命令与输出（48 / 124 / 1、六平台 rung 清单）落盘为可回读 JSON | 快照 JSON 落盘、`git status` 白名单空 |
| ② | 逐行核对 `execute_claimed` → `sandbox.dispatch_script` 的实际参数语义（`gated` / `timeoutSeconds` / `process_root` / 写越界行为），确认 script stage 在当前 0.13.1 上对用户工作流**可用且不依赖平台专有代码** | 结论落盘；若发现不可用则停止本 P 表并回来改判据 |
| ③ | 写《Executor 边界》治理文本并入 `versions/`：runner 执行（script / software / process gate） vs host 执行（prompt stage），含降级契约（无密封环境 → `CAPABILITY_UNAVAILABLE`、不留半截产物） | 文档可回读 |

**判据**：三份产物（快照 JSON / 链路结论 / 边界文档）落盘可读；**零生产字节改动**；白名单 `git status` 空。

## P2 定义面增容 — 三个试点（约 2–3 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 从 `expert-task` / `framework-pipeline` / `research-analyst-pipeline` 三个工作流中，各选 **1 个确定性子步骤**（有输入有输出、可用脚本判定成败的），作为 script stage 或 process gate 候选；列选点理由（不得选需要模型判断的步骤） | 三点选点表落盘 |
| ② | 为三个工作流各建**新版本目录**（`current` 不翻），把候选步骤改写为 script stage + `outputs` schema + gate（`expectExit` / `expectArtifacts` / `maxIterations` / `onFail: repair`） | 三个新目录文件齐备 |
| ③ | 逐文件 sha256 复算 + `local_schema`（Draft 202012）校验通过 + `SOURCE.json` 留痕（changes / unchanged / openDeferred） | SUMS 全绿、SOURCE 可读 |

**判据**：3 个新版本目录；每目录 `SHA256SUMS` 逐项一致；`local_schema` 校验通过；**已发布版本字节零改动**（git diff 只在新增目录）。

## P3 真·落地自证 — workbuddy 平台一次真跑（约 2–3 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 在 workbuddy 平台用 P2 的试点之一跑完整链：`prepare` → `claim`（应交付 `task.script`）→ `submit` → 至 `succeeded` | run 目录与 `run-lock.json` 落盘 |
| ② | 沙箱边界验证：脚本尝试越出 `process_root` 写入 → 必须被拒且 run 不留半截产物 | 负面用例证据 |
| ③ | timeout 语义：人为构造超时 → 按 `timeoutSeconds` 终止并结构化报错 | 超时证据 |

**判据**：`succeeded` 1 次 + 越界拒绝 1 次 + 超时 1 次，全部落在 `workbuddy/runtime/runs/<id>/`，产物哈希可回读。
**执行方式**：给用户一条逐字命令在自己终端跑；会话内只回读产物（见 §0.3）。

## P4 降级与幂等（约 2 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 密封环境缺失 / 被篡改 → 应返回结构化 `CAPABILITY_UNAVAILABLE`，**不留半截产物**（D-27 语义验收） | 负面用例证据 |
| ② | 幂等重放：同一 stage 重复 `execute` → 结果哈希与首次一致、事件流不丢前缀 | 重放证据 |
| ③ | 三个试点各补 1 条最小回归，并入既有检查；由单条 `conform` 命令集中出 digest | digest 输出 |

**判据**：三类用例（降级 / 幂等 / 回归）全绿；conform 单条命令出 pass/fail + digest，不手工挑选用例。

## P5 平台面 — 只读回读 + 第二平台单次真跑（约 2–3 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 六平台只读回读：rung 存在、backend 文件存在且可读、sealed 目录存在（不跑业务、不跨读别平台 runtime 私有项） | 六平台读数表 |
| ② | 选 **codex** 复跑一次 P3 的完整脚本 stage 链（同样在用户终端执行，见 §0.3） | codex 侧 run 证据 |
| ③ | 各平台在自己的 `bridge/platform.md` 声明已验证组合；**结论不互抄**（BP-2） | 平台章片段可读 |

**判据**：六平台读数完整（含 backend 差异：qoder=WSL2、其余=manager-sealed 形态）+ codex 一次真跑 succeeded；未验证的平台如实记「未验证」，不得写成「支持」。

## P6 入库与收口（约 2 小时）

| 子块 | 内容 | 停手点 |
| --- | --- | --- |
| ① | 补 `versions/更新日志.md` 与相关平台章；稽查治理文本里「prompt-mode / 无 executor」的旧表述并按 §0 结论改写 | 文档可读 |
| ② | 推 GitHub 前过凭据 / 本体 / 大文件扫描；逐端口试 push（7897 / 20168 / 5018） | 推送结果明确 |
| ③ | 出四项收口读数 | 读数表 |

**判据（BP-6 四项）**：HEAD sha；白名单 `git status` 空；远端与本地一致（ahead/behind 0）；入库时间早于任何清理动作。全不通时如实报「未推送 + 本地领先 N」。

---

## 明确排除（本轮不做，不当顺手项）

1. **不把模型推理循环纳入 runner** —— prompt stage 由 host 执行是设计边界；吞入需要模型凭据进共享仓运行态，违背 BP-1 §1.6 与 BP-2。本轮只把它**成文**，不模糊化处理。
2. **不做全仓 123 个 prompt stage 的硬化** —— 只做确定性子步骤；目标是证明通路，不是批量 Conversion。
3. **不新增阶梯档位**（`platform-venv` / `host-controlled`）：属独立议题，需另立 P 表（涉及「主机一档必须当次自带用户同意」的语义）。
4. **不跑六平台全矩阵**（BP-3）。
5. **不翻共享 `current`**：P2 只建新目录、不动 current；是否切换默认由你单独决断（切默认＝全平台默认行为变更，带 48h 观察窗）。
6. **不顺手修 D-123 / D-124 / D-127 / D-148 / D-152 / D-157**：本轮撞见只登记，收口后统一另出修复方案。

## 完成判据汇总

按上表 P1–P6 各自判据跑完即＝本任务完成；同一轮内不追加验收项、不提高判据门槛。等待型观察项（如切 current 后的 48h）归完成后维护期。


---

## 收口记录

### P1 完成（2026-10-27 23:20，workbuddy 会话）

- **P1-① 快照**：`workbuddy/runtime/maintenance/20261027-executor-adoption/p1-snapshot.json`（生成脚本同目录 `p1-snapshot.py`，可重跑复算）。核心读数：HEAD `b2f77d96`；48 工作流 / 124 stage = prompt 123 : script 1，纯 prompt 47/48；引擎五件文件哈希入档。六平台 rungs 回读修正 §0.1 两处「待 P1 回读」：**codex=`wsl2-ubuntu.json`（linux 族）、dsh=`manager-sealed.json`（host 族）**。
- **P1-② 链路结论**（已并入《Executor边界-20261027.md》§1/§3/§4）：`execute_claimed` → `start_script` 全链可用；entry 仅限 `.py` + 结构化 argv；attempt 目录独占（jail/scratch/stdout/stderr/result/process/cancel/authorize）；`gated` 授权门；timeout 默认 30s；已派发脚本拒绝重放（`UNKNOWN_OUTCOME`）；backend 按 `kind` 二族（host → `sandbox_host.py`，否则 `sandbox_linux.py`）；执行路径纯配置驱动，无平台专有代码。**判据达成：script stage 在 0.13.1 上对用户工作流可用。**
- **P1-③ 边界文档**：`versions/Executor边界-20261027.md`（执行权划分 / prompt 归 host 的 BP-1 §1.6+BP-2 依据 / 硬边界七条 / 降级触发点五条 / 平台装配三件判据）。
- **P1 新发现（登记，非阻断，不顺手修）**：`doubao` rung 缺 `scriptEnvironment` 键且 `executionBackend` 所指文件不存在（三件缺两），预期脚本面全部 `CAPABILITY_UNAVAILABLE`；与 09-16 升格时的软件面受限语境一致。待 P4 降级用例真机复核后归档。修法（补装 backend+sealed）属平台侧另批。
- **零生产字节改动**：`git status` 仅 4 个本轮新增未跟踪产物（P 表、边界文档、快照 py/json），既有跟踪文件 0 修改。


### P2 完成（2026-10-27 23:58，workbuddy 会话；24 点停手）

- **P2-① 选点表**：`workbuddy/runtime/maintenance/20261027-executor-adoption/p2-selection.md`。选点统一为「WORK 与 REPORT 之间插入 AUDIT script stage」（确定性完备：输入 output.json / 输出 audit-manifest.json / 成败 exit code；从 WORK prompt 的 deliverables 语义抽出而非新造职责；v2 schema 已由 wf-runner 自身证明支持 script action，expert-task 无需升 schema）。research-analyst-pipeline 选 **1.2.0 derivedFrom 1.1.0**（1.1.0 已被 qoder 显式钉走，避免从 1.0.0 起跳造成血缘分叉）。
- **P2-② 三个新版本目录**（构建脚本 `p2-build.py` 同目录，可复算）：
  - `tool/expert-task/versions/1.2.0`（14 文件）
  - `tool/framework-pipeline/versions/1.2.0`（14 文件）
  - `tool/research-analyst-pipeline/versions/1.2.0`（14 文件）
  - 每目录：既有文件逐字节复制（filecmp 全等验证）；workflow.yaml 只追加 AUDIT stage（stages=INTAKE>WORK>AUDIT>REPORT）+ requiredStages + version；manifest.json 只改 version；SOURCE.json 按 `ai-release-source/v1` 留痕；新增 `scripts/audit_deliverables.py` 与 `schemas/audit.schema.json`；SHA256SUMS 全目录重算。
- **P2-③ 验证读数**：SUMS 逐项复算 3/3 目录零坏项；继承文件与旧版逐字节 diff = 空；结构断言（版本号/依赖序/action/script 入口/requiredStages）全过；audit 脚本三场景功能冒烟（runpy 直跑，无子进程）：file+inline+missing → exit 1 / status failed，all-good → exit 0 / status passed（sha256 与 bytes 正确），no-input → exit 2。
- **P2 遗留小项（如实登记，不称完成项）**：`local_schema` 的 Draft 202012 校验未在本会话跑（当前解释器无 jsonschema 包，密封环境 python 未接线到本会话）；audit.schema.json 的 `check_schema` 与样例校验顺延到 P3 起跑时在 runner 密封环境内完成。**此项不阻塞 P3。**
- **零生产字节改动**：`git status` 仅 5 个未跟踪新增（三版本目录 + P 表 + 边界文档），既有跟踪文件 0 修改；`current.json` 未翻（排除项 5 遵守）。
- **停手状态**：P1 全部 + P2 全部（含上述一项顺延）完成；P3 及以后未开工。下一轮从 P3 起。


### P3 中期记录（2026-10-28 00:20，workbuddy 会话；等待用户终端执行）

- **已完成（P3-① 前半）**：invocation-smoke 对 expert-task@1.2.0 三步全绿（prepare/next/stop，`businessStagesExecuted=false` 设计如此）——**P2 顺延项闭合**：引擎 `local_schema` 接受了 1.2.0 定义（含 AUDIT stage 与 audit.schema.json）。完整 run（driver `p3-driver.py`，run-03）走到 AUDIT：prepare→next-INTAKE→submit-INTAKE→next-WORK→submit-WORK（含 host 预跑 work-integrity gate）→**next-AUDIT 交付 `task.script = {resourceKey:"workflow:expert-task", entry:"scripts/audit_deliverables.py", argv:[], timeoutSeconds:30}`**——**P3 核心断言「引擎把 AUDIT 作为 script stage 正确 claim」已达成，证据在 `runtime/runs/20261027-executor-adoption-run-03/`**（state: running / activeAttempt: AUDIT/1/script）。
- **外部阻断（非引擎缺陷，P 表 §0.3 预判命中）**：`execute` 时引擎 backend（kind=wsl2）要启动 `C://WINDOWS//System32//wsl.exe`，被 agent 进程树的安全策略**程序黑名单**拦截（`CreateProcess` WinError 5 拒绝访问）。run-03 状态干净、可续跑。
- **P2 修订补记**：audit_deliverables.py 输入约定修正（script 的 cwd 是 run 的 work/project，改为自动定位 `../../evidence/WORK/<最大attempt>/output.json`；deliverable path 按 WSL `/mnt/e/...` 绝对形态解析）；audit.schema.json 增 source 字段；三个 1.2.0 目录已重铺并重算 SUMS（1.2.0 未入库，修正合法）。
- **协议坑记录**：prepare 请求禁带 expectedStateRevision（schema not 约束）；work/report 的 status 枚举是 pass/partial/blocked（非 delivered）；gate 由 host 预跑并按 ai-gate-evidence/v1 声明（gates[].inputSha256=attempt 的 inputSha256、outputManifestSha256=codec.hash(outputs)、evidence={path,sha256,size}）；outputs 必须按 path 排序。
- **下一步**：用户在自己终端跑 `--execute 20261027-executor-adoption-run-03`（wsl.exe 在用户终端不受黑名单限制），回执后本会话继续 submit-AUDIT → REPORT → stop 至 succeeded；随后 P3-②③ 负面用例（越界/超时经 sandbox 直测或第二 run）。


### P3-① 完成（2026-10-27 23:50，workbuddy 会话 + 用户终端 execute）

- **run-04 完整 succeeded**：prepare → INTAKE(prompt) → WORK(prompt+work-integrity gate) → **AUDIT(script stage 真执行)** → REPORT(prompt) → 终态 `succeeded`。用户终端 execute 读数：`{"exitCode":0,"reason":"exited","processTreeEnded":true,"elapsedMilliseconds":783,"landlockAbi":3,"controllerExitCode":0}`——**在 WSL2 + Landlock(Abi 3) 沙箱内真实执行**。
- **AUDIT 产物被引擎接受为 attempt evidence**：audit-manifest `status=passed`（file deliverable 226B / inline 29B，逐项 sha256），submit-AUDIT ok，evidence/AUDIT/1/{output.json,audit-manifest.json} 哈希一致（8d0c22ae…）可回读。
- **事件流**：15 条（prepared / stage-claimed×4 / prompt-delivered×2 / result-accepted×3 / process-exited / succeeded），run-lock 含 environmentSealed/frozen/expandedGraphSha256。
- **沙箱输入摆放约定（本轮实测发现并固化）**：script 的 chroot jail 可见面 = /release + /work(cwd,可写) + /scratch + /environment + /shared(三仓只读)；evidence 在 jail 外不可见 ⇒ host 双摆：evidence 侧（引擎证据）+ work 侧（data/raw/work-output.json 输入区 + deliverables/ 实体）。audit 脚本与三目录 1.2.0 已按此修订并重算 SUMS。
- **附带负面证据（P3-② 前置）**：run-03 因 audit exit 2（evidence 不可见）干净落 `failed`（EXECUTION_FAILED 非 retryable、状态机不挂起）——「脚本失败 → run 终态」路径已证。
- **协议坑（新增）**：report.schema.json 无 `pending` 字段（additionalProperties:false，workflow.md 的 prompt 描述与 schema 有轻微滞后，不本轮修）；失败的 submit 事务也占用 idempotencyKey，重试须换 requestId。
- **P3-②③ 待办**：`p3-negative.py`（沙箱直测：越界五项探针 + timeoutSeconds=3 vs sleep 65）已就绪，须用户终端跑（wsl.exe 黑名单）；fixture 在 `sandbox-probe/scripts/`。跑完即 P3 收口。


### P3 完成（2026-10-27 23:45，workbuddy 会话 + 用户终端两轮配合）

**P3 三判据全部达成**：

1. **succeeded 1 次**：run-04（见上一节 P3-① 记录）——AUDIT script stage 在 WSL2+Landlock 沙箱内真执行，产物被引擎接受为 attempt evidence，终态 `succeeded`。
2. **越界拒绝 1 次**：`p3-negative.py` escape 用例（用户终端跑，报告 `p3-negative-report.json`）。五项探针读数：
   - `write ../../escape-marker.txt` 与 `write /escape-marker.txt` → 脚本内"succeeded"但**只落在 chroot jail 内 tmpfs**——真实文件系统 `realFilesystemMarkers: []` 零 marker（chroot 边界有效，上跳出不了 jail root）；
   - `read /etc/passwd` / `write /tmp/...` → FileNotFoundError（chroot 外路径不存在）；
   - `write /release/escape-marker.txt` → **`OSError: Read-only file system`**（release 只读 bind 生效）。
3. **超时 1 次**：timeout 用例——timeoutSeconds=3 vs 脚本睡 65s → `exitCode -9`（SIGKILL，killpg）、`reason=timeout`、`elapsedMilliseconds 3024`（外层 3547ms）、`reachedEnd=false`（脚本末行永不打印）。

**附带证据**：run-03 = 「脚本 exit≠0 → run 干净落 failed（EXECUTION_FAILED 非 retryable）」。

**P3 遗留（如实登记，非阻断）**：
- `realFilesystemMarkers` 扫描范围是 EVID 与 work 目录两级 rglob；严格的"全盘扫描"未做（成本不成比例，BP-3 三问不过）。
- 越界探针中 `../../` 上跳在 chroot 内天然到 jail root 为止，未单测「jail root 本身被写出」——jail root 是 tmpfs mount，宿主侧无从落点，属设计性防护而非可绕过面。

**停手状态（23:45）**：P1 + P2 + P3 全部完成；**P4（降级/幂等/单条 conform digest）按用户指令暂不执行**，P5/P6 未开工。全部产物落盘可回读，`current` 未翻、既有跟踪文件零修改。


### P4 完成（2026-10-28，workbuddy 会话；全部三类用例在会话内跑通）

**判据达成：降级 3/3 · 幂等 1/1 · 回归 3/3 + 单条 conform digest。**

1. **P4-① 降级**（`p4-degradation.py` → `p4-degradation-report.json`，**ALL PASS**）
   三个 case 全部在 `execute` 阶段被**结构化拒绝**，且**零半截产物**（`managed-script.json` 无、attempt 目录 0 个、`stateRevision` 不变，run 仍停 `running / AUDIT`）——因为三处 raise 都在 `store.write(dispatch-intent)` 之前（`engine.py` L1956–1989）：

   | case | 构造 | 实测码 | 半截产物 | 判据 |
   | --- | --- | --- | --- | --- |
   | a 缺 `scriptEnvironment` 路径 | 指向 `DOES-NOT-EXIST` | `INVALID_REQUEST` | 无 | PASS |
   | b 缺 `executionBackend` 文件（复刻 doubao 三缺二形态） | 指向不存在的后端文档 | `CAPABILITY_UNAVAILABLE` | 无 | PASS |
   | c 未密封空目录 | 存在但非密封环境 | `HASH_MISMATCH` | 无 | PASS |

   **判据修订（据实更正，不粉饰）**：P 表初稿写「密封环境缺失/被篡改 → 应返回 `CAPABILITY_UNAVAILABLE`」**过粗**。实测引擎按失效类别刻意分码，且源码有注释背书：a 走 `INVALID_REQUEST` 是 **D-56**（拼错的环境根目录按"输入问题"回答并点名配置键，调用方可修）；b 走 `CAPABILITY_UNAVAILABLE` 才是 **D-27** 的「阶梯不再提供本 run 钉的 execPath」；c 走 `HASH_MISMATCH`（解释器根与钉版快照不符＝完整性失效，与"不可用"是两个语义类）。**D-27 的 `CAPABILITY_UNAVAILABLE` 只覆盖 b 这一类**，初稿口径把三类混成一类。已按源码契约把每 case 期望码定死并在报告里保留 `d27Code` 字段（标记是否恰为 `CAPABILITY_UNAVAILABLE`：a=false / b=true / c=false）。

2. **P4-② 幂等重放**（`p4-idempotency.py` → `*-dispatch.json` / `*-replay.json`，**PASS**）
   run `20261028-p4-idem-01`：AUDIT claim 交付 `task.script={resourceKey:workflow:expert-task, entry:scripts/audit_deliverables.py, argv:[], timeoutSeconds:30}`；首次 `execute` 在 WSL2+Landlock(Abi 3) 沙箱内真执行（`exitCode 0 / 552ms / controllerExitCode 0`）；**第二次 execute → `UNKNOWN_OUTCOME: A dispatched script is never replayed`**，且证据哈希不变、events 前缀不丢（10 行 → 10 行）、无新 attempt 目录（`[]` → `[]`）、工作区文件数不变（3 → 3）。

3. **P4-③ 回归 + 单条 conform digest**（`p4-regression.py` → `p4-regression-report.json`，**PASS**）
   三试点各一次 `invocation-smoke`（prepare/next/stop 三步全 ok，`businessStagesExecuted=false`），plan 序列均为 **INTAKE(prompt) > WORK(prompt) > AUDIT(script) > REPORT(prompt)**，`hasAuditScriptStage=true` 3/3。单条 `conform`（`platform-conformance/1.6.3`，rc=0，1.3s）：**`items=32 pass=32 declaredAbsent=0 unverified=0 remediationMissing=0 floorReached=True`**，`unionSha256=8e1b7dbb5837a5b393558f74f00da541fa1b320940b42349c1e09693ebac8892` —— **机器可判项收敛为一条命令，未手工挑选用例**。
（**digest 口径更正**：初稿另引了「报告自身 `reportSha256=1c344530…`」，该值**不可作 digest**——conform 报告含 `generatedAt` 字段，每次生成都刷新，故其文件哈希不稳定；跨重跑逐字一致的只有 `unionSha256`（本轮复跑已验证一致）。当前报告文件哈希为 `4c1bafb114e8…4615`，仅作留痕。）

**本轮登记项（非阻断，不顺手修）**

- **发布树 `__pycache__` 污染（D-46 家族，本轮真实撞上并已修复）**：P3 期间 driver 脚本 `sys.path.insert(RUNNER) + import runtime_core` 向**已发布目录** `tool/wf-runner/versions/0.13.1/` 写入 `__pycache__/`（runtime_core + sandbox，cpython-312）。repo-lint 完整性门报 R11 `generated-cache` / `forbidden-file` + R3 `unlisted-file` 5 条 ⇒ `resolution.py:161` 抛 **`HASH_MISMATCH: Runner source package is incomplete`，此后每一次 prepare 全被拒**（本轮 P4 首跑三例全栽在此，一度误判为 rung 问题）。处置：删除该目录后 `findings: []` 复验通过，后续一律带 `PYTHONDONTWRITEBYTECODE=1` 运行。**规则：任何 import 共享仓发布目录 Python 模块的脚本，必须 `-B` + `PYTHONDONTWRITEBYTECODE=1`；出现 prepare 全线 HASH_MISMATCH 时先查 `__pycache__`。**

**收口读数**：`git status` 仅 5 项未跟踪新增（三个 1.2.0 版本目录 + P 表 + 边界文档），**既有跟踪文件 0 修改**；HEAD 仍 `b2f77d96`；`current` 未翻；发布树 `__pycache__` 复检为 0。

**停手状态**：P1–P4 全部完成；**P5（六平台只读回读 + codex 复跑）、P6（入库/push/四项读数）未开工**。


### P5 中期记录（2026-10-28，workbuddy 会话；①③ 完成，② 待用户终端执行）

**P5-① 六平台只读回读完成**（`p5-readback.py` → `p5-readback.json`）。只读：只判存在性 + 文件自身 sha256 + backend 的 `kind`，**不跑业务、不跨读别平台 runtime 私有项**。

| 平台 | rung | backend（rel / kind / sha16） | sealed 目录 | 环境清单 files | 判据 |
| --- | --- | --- | --- | --- | --- |
| codex | 1 档 kernel-sandbox | `codex/bridge/backends/wsl2-ubuntu.json` / wsl2 / `978a93be19c1bb74` | 存在 | 3831 | 齐备 |
| dsh | 1 档 | `dsh/bridge/backends/manager-sealed.json` / **wsl2** / `79d606bef6ff2b63` | 存在 | 3831 | 齐备 |
| workbuddy | 1 档 | `workbuddy/bridge/backends/manager-sealed.json` / wsl2 / `79d606bef6ff2b63` | 存在 | 317 | 齐备 |
| zcode | 1 档 | `zcode/bridge/backends/manager-sealed.json` / wsl2 / `79d606bef6ff2b63` | 存在 | 3831 | 齐备 |
| qoder | 1 档 | `qoder/bridge/backends/wsl2-ubuntu.json` / wsl2 / `e95485aad8a878c7` | 存在 | 3831 | 齐备 |
| doubao | 1 档 | `doubao/bridge/backends/manager-sealed.json` **文件不存在**（无 `backends/` 目录） | **键缺失** | **0 条** | **不齐** |

**修正一处旧读数**：§0.1 曾按文件名记「qoder=WSL2、其余=manager-sealed 形态」，易被读成后端类型不同。实测**六平台 backend 的 `kind` 全为 `wsl2`**（`manager-sealed.json` 只是文件名，`kind` 仍是 wsl2；这也正是 `engine.py` L1979-1983 对密封档的硬要求）。差异只在文件与密封环境路径，不在后端类型。

**并行事件登记（影响收口读数，非本轮产物）**：本轮 P5 进行中，另一会话以 **`4a8416dc Register qoder-cn via graphical onboarding`** 登记了**新平台 `qoder-cn`**（16 文件 / +573 行：bridge.json、capabilities.json、backends/manager-sealed.json、qoder-cn-config.json、platform.md 等），并在其下留有 **3 个未提交改动**（`qoder-cn/bridge.json`、`qoder-cn/bridge/qoder-cn-config.json`、`qoder-cn/bridge/software-gateway-config.json`，+18/−9）。三项处置：① 回读（只读）已补入 qoder-cn —— `ladder=True`（1 档 kernel-sandbox、backend `manager-sealed.json` kind=wsl2、sealed 存在）；② **本轮不写 qoder-cn 任何文件**，其平台章登记归它自己的接入轮，避免与并行会话争用；③ 那 3 项未提交改动**不在本轮入库范围**，P6 时只提交本轮范围，或由你决定如何与并行会话合并。

**doubao 精确化为「三件全缺」**（P1 记为「三缺二」，本轮更精确）：backend 文件不存在 + `scriptEnvironment` 键缺失 + 环境清单 `files` 为空（该 `environment.json` 是 3.9.13 时代的遗留形态，只有 `packages`/`pythonVersion`，无 `files`/`environment`）⇒ 脚本面预期**全部结构化降级**（P4-① case b 已复刻该形态并实测得 `CAPABILITY_UNAVAILABLE` + 零半截产物）。补齐属平台侧另批议题，本轮只登记不修（用户已明示「豆包不管」）。

**P5-② codex 复跑：完成，终态 `succeeded`**

- 链路：`prepare` → INTAKE → WORK（含 host 预跑 work-integrity 门禁）→ **`next-AUDIT` 正确 claim 为 script stage**（`task.script={resourceKey:workflow:expert-task, entry:scripts/audit_deliverables.py, argv:[], timeoutSeconds:30}`）→ **AUDIT 真执行** → submit-AUDIT → REPORT → **终态 `succeeded`**（四阶段全 completed，事件流 15 条）。run `20261028-p5-codex-01` 在 `codex/runtime/runs/`。
- 真执行读数：`{"exitCode":0,"reason":"exited","processTreeEnded":true,"elapsedMilliseconds":604,"landlockAbi":3,"controllerExitCode":0}`——**WSL2 + Landlock(Abi 3) 沙箱内真实执行**；产物 `audit-manifest.json`（`status=passed`，file/inline 两项各带 sha256）被引擎接受为 attempt evidence（`evidence/AUDIT/1/{output.json,audit-manifest.json}`）。
- 过程与解阻：会话内 `execute` 被 `wsl.exe` 安全策略拦（WinError 5）→ 交用户终端 → 首次终端执行报 `ENVIRONMENT_VERIFY_TIMEOUT` → 用户在终端以**不带时间上限**的方式手动跑一次 `environment_verify.py` 生成 attestation（结果 `mode=full, listed=3831, rehashed=3831, mismatches=0` ⇒ **环境完整未被篡改**）→ 再次 `execute` 走**增量校验**，604ms 通过。
- 协议小记：`submit-REPORT` 直接把 run 置为 `succeeded`，此后调用 `stop` 返回 `INVALID_REQUEST`（终态后无需 stop，协议如此，非缺陷）。
- codex 平台章已由「待验证」改为「**已验证**」，并附本平台的已知限制（见下条登记）。

**P5-③ 六平台平台章登记完成**（`p5-platform-notes.py`）：六份 `bridge/platform.md` 各追加 21 行「执行器落地 P5 轮登记」段（逐文件 `git diff --stat` 均为 `21 +++`，无行尾归一膨胀——脚本按各文件原行尾 CRLF 追加）。真跑状态逐平台如实区分：workbuddy=已验证（P3/P4 本平台自跑证据）；codex=待验证；dsh/zcode/qoder=**未验证**（只回读、未在该平台跑脚本 stage，明写「不得据此写成支持」）；doubao=不适用（阶梯不齐）。每段都带 BP-2 边界声明：回读读数**不等同于该平台自己发起的复验**，结论不互抄。

**判据达成情况（P5 完成）**：P5-① 六平台读数完整（含 backend 差异与 doubao 三缺）✅ · P5-② codex 一次真跑 `succeeded` ✅ · P5-③ 六平台平台章登记可读、未验证者如实记「未验证」✅。

**停手状态**：P1–P5 全部完成；**P6（入库 / push / 四项收口读数）未开工**。


### P6 收口记录（2026-10-28，workbuddy 会话）

**P6-① 治理文本**：
- `versions/更新日志.md` 追加《2026-10-28 Agentic Workflow 共享执行器落地（P1–P6 收口）》条目（13 行，按文件原行尾 CRLF 追加）。
- 旧表述稽查：根级 `*.md` 与 `versions/*.md` 中，涉及 agentic workflow 的「prompt-mode / 无 executor」表述**只出现在 P 表自身的修正语境与《Executor边界》的正确口径里**，无需改写。管理台相关文档中的「没有执行器 / 无执行器」指**管理台的 git / provider 执行器**，与本任务同名不同义，**不改写**（已在更新日志中注明该口径）。

**P6-② 入库与推送**：
- 入库前三项扫描全清：**大文件**——三个 1.2.0 目录共 42 文件 / 74 KB，无 >100 KB 项；**本体**——无 `.exe/.dll/.so/.zip/.whl/.pyd/.pyc`；**凭据**——`password|secret|api[_-]?key|BEGIN RSA/PRIVATE|ghp_|sk-|Bearer|AKIA` 全扫，唯一命中是 P3 记录里的路径 `/etc/passwd`，非凭据。
- **提交 `68d2e7fc`**（51 文件 / +2865 行），范围严格限定本轮产物（三个 1.2.0 目录 + P 表 + 边界文档 + 更新日志 + 六份 platform.md）；**qoder-cn 三项未暂存改动不在此列**（并行会话，归其自行提交）。
- **推送未达成**：逐端口试 `7897 / 20168 / 5018` 全部 `Failed to connect`；直连返回 `CONNECT tunnel failed, response 502`（环境注入的代理在生效）；另试 `1080 / 10809 / 7890 / 8888 / 9080 / 9180 / 10000 / 30000` 均失败。**根因：本机无梯子进程在运行**（`tasklist` 无 clash/verge/sing-box/v2ray），`netstat` 显示 7897 / 5018 / 20168 均未监听。⇒ 按 BP-6 如实记「**未推送 + 本地领先**」，不谎报。

**P6-③ 四项收口读数（BP-6）**

| 项 | 读数 | 判定 |
| --- | --- | --- |
| ① HEAD sha | 本轮提交 **`68d2e7fc`**（父 `4a8416dc` 为并行会话的 qoder-cn 接入，非本轮产物） | ✅ |
| ② 白名单 `git status` 空 | 本轮范围**全部入库，工作区为零**；仅剩 `qoder-cn/` 三项未暂存改动（并行会话，不在本轮范围，显式排除） | ✅（范围口径） |
| ③ 远端与本地一致 | **未达成** —— 远端不可达（无可用代理），无法回读比对。相对 10-27 记录的远端读数 `b2f77d96`，**本地领先 2 笔**（`4a8416dc` + `68d2e7fc`） | ❌ 如实报未推送 |
| ④ 入库时间早于破坏动作 | 本轮唯一清理动作是删除 `tool/wf-runner/versions/0.13.1/__pycache__`，发生在 HEAD `4a8416dc` 之后、本轮提交 `68d2e7fc` 之前；被删对象是 **git 忽略的生成缓存**（不在版本历史中，无字节可回滚），清理前后已用 `lint.Scanner.integrity(...).findings` 复验（`[]`）。故对**版本化内容**该条成立 | ✅（附口径说明） |

**推送待办（需你在本机起梯子后执行）**：
```
git -c http.proxy=http://127.0.0.1:<混合端口> push origin main
```
注意：该推送会连带把并行会话的 `4a8416dc`（qoder-cn 接入）一并推上远端（它是 `68d2e7fc` 的父提交，无法只推后者）。若你不希望如此，需先在 qoder-cn 会话侧协调。


### 收口后维护记录（2026-10-28，用户授权：推送 → 清理 → 整理 → 优化代码）

**① 推送已完成，四项读数全部达成**：梯子起来后经 **7897** 一次推成 —— `b2f77d96..100e64bf`；回读 `git ls-remote origin main` = `100e64bf7e3f…94a2`，与本地 HEAD 同值，`git rev-list --left-right --count origin/main...main` = **0 / 0**。第③项由「未达成」转为达成；连带推上 `4a8416dc`（qoder-cn）已事前告知。

**② 清理（范围：只删中间请求件，用户选定）**：删除 39 个纯中间件（`p3-req-*` 12、`p4-req-*` 9、`p4-idem-*` 6、`p4-smoke-*` 3、`p5-codex-req-*` 10）——全部可由驱动脚本重跑再生。**保留**全部判据报告、驱动脚本、run 目录与 `p4-config/`、`p4-runs/`、`logs/`（引擎诊断）。

**③ 整理**：`workbuddy/runtime/maintenance/20261027-executor-adoption/` 按 P1–P6 归档为 `p1/`…`p5/` + `lib/`，41 项移动到位，根目录只留这六个子目录与新建的 `INDEX.md`（逐文件：bytes / sha256 前 12 位 / 用途 / 复算命令 / 红线 / 稳定与不稳定 digest 说明）。

**④ 代码优化（不动已发布 1.2.0 —— 已入库即已发布，红线：字节不可覆盖）**：
- 新增 `lib/adoption_common.py`：只放路径常量 + 无副作用纯函数（请求信封 / 文件条目 / 证据落盘 / 门禁证据 / CLI 调用封装 / 统一 `--help`），**不放任何判据逻辑** —— 抽公共样板的目的是去重复样板，不是改验收语义。
- 9 个脚本接入：产物路径常量统一走 `stage("pX")`，全部支持 `--help/-h`；补齐 3 个脚本缺失的 `import sys`。
- **修掉一个真实缺陷**：`p4-regression.py` 原先硬编码 `run_id` 与幂等键，重跑必然撞 `IDEMPOTENCY_CONFLICT`，等于不可重跑 —— 新增 `--tag`（换 runId 与幂等键），并把 smoke 请求件改写到临时文件、用后删除（不再堆积中间件）。
- 四个已产出证据的驱动脚本（p3-driver / p4-degradation / p4-idempotency / p5-codex-run）**只加 `--help` 与路径常量，判据与调用序列一字未动**，以保证本轮证据仍可被原样复算。

**⑤ 优化后验证（重跑比对）**：
- `p5/p5-readback.py` 重跑：输出与归档读数逐字一致（`complete=[codex,dsh,workbuddy,zcode,qoder,qoder-cn] / incomplete=[doubao]`）。
- `p4/p4-regression.py --tag verify` 重跑：`smoke 3/3 passed`、`hasAuditScriptStage 3/3`、`conform rc=0 / floorReached=True`、`unionSha256` 与归档**逐字相同**、`p4-conform-union.json` **整体相同**；仅 `conform.reportSha256` 变化（`generatedAt` 刷新所致，已在上方更正 digest 口径）。

**P5 新登记项（非阻断，本轮只登记不修）**

- **环境校验预算与环境规模不匹配（首次全量校验超时）**：codex 侧 `--execute` 返回 `ENVIRONMENT_VERIFY_TIMEOUT`——`environment_guard.verify_script` 起 `wsl.exe -d Ubuntu2204 --exec /usr/bin/python3 -B …/environment_verify.py <manifest> - <attestation>`，对密封环境做**首次全量哈希**，在 `verifyTimeoutSeconds=120` 内未跑完。实测参数对照：

  | 平台 | backend 文件 | 声明预算 | 环境清单条数 | 组合 |
  | --- | --- | --- | --- | --- |
  | codex | `wsl2-ubuntu.json` | **120s** | **3831** | 预算最小 × 环境最大 |
  | dsh / zcode / qoder | `manager-sealed.json`（qoder 另有 120s 的 `wsl2-ubuntu.json`，当前未接线） | 300s | 3831 | 未实测，可能同样吃紧 |
  | workbuddy | `manager-sealed.json` | 300s | 317 | 已验证通过 |

  性质判定：**不是平台能力缺失，也不是环境被篡改**（`environment_guard.py` L62-68 的 F4 注释明写"预算耗尽不是篡改的证据"，与 `HASH_MISMATCH` 刻意分开）。
  **两种解释待分辨（11:39 更新）**：① 校验走 drvfs（`/mnt/e`）跨文件系统哈希 3831 个文件的 I/O 成本超预算；② **WSL 虚拟机本身没起来**——用户终端随后手动执行同一条校验命令时，WSL 报 `wsl2.hostAddressLoopback` / `wsl2.autoMemoryReclaim` 两键未知（该 WSL 版本不支持），继发 `CreateInstance/CreateVm/ConfigureNetworking/0x8007054f`、`networkingMode Mirrored` 配置失败回退 None。若属 ②，则 120s 超时是 WSL 启动挂起，与哈希成本无关。判据：先 `wsl --shutdown` 复位后复测——复位后能在预算内完成 ⇒ ②；仍超时 ⇒ ①。
  注：本机 WSL 与 `.wslconfig` 属用户个人环境，本会话**只读诊断、不代改**。
  处置路径（无需改共享仓）：先用一次**不带时间上限**的手动校验生成 attestation（`environment-verification.json`），此后 `verify_script` 走**增量模式**（只 stat 全表 + 重哈希 5% 抽样），预算内即可完成；若增量仍超时，再考虑由 codex 平台侧自行上调 `verifyTimeoutSeconds`（该键是平台声明项，取值 1..3600，**不由本会话代改**——BP：一个平台不得修改另一个平台的配置）。
  影响面：codex 已实测；dsh / zcode / qoder 未实测，同规模环境 + 300s 预算是否会触发待各自平台自测确认。

- **（承上，更精确的定位）attestation 按 run 存放 ⇒ 每个新 run 的首次 `execute` 必做一次全量校验**：`engine.py` L1994 传入的 `store_root` 是 run 目录，`environment_guard.verify_script` 因此把 `environment-verification.json` 写在**该 run 内**、不跨 run 复用（`environment_guard.py` L52-56）。故「先生成 attestation」只对**同一个 run** 生效——下一个新 run 的首次 `execute` 仍会撞同一预算。结合上条：codex（3831 条 / 120s）**每个新 run 的首次 execute 都会 `ENVIRONMENT_VERIFY_TIMEOUT`**，除非 ① 由 codex 平台侧上调 `verifyTimeoutSeconds`（平台声明项，1..3600），或 ② 改用共享/跨 run 的校验缓存（属引擎侧改动，须另立 P 表，本轮不做）。
  本轮的处置是**绕行而非修复**，如实记录：codex 的真跑证据有效（终态 succeeded、AUDIT 真执行），但该平台在正常流程下仍会在新 run 首次 execute 处被预算挡住。
- **未取得的一个读数**：全量校验的真实耗时没有测到（计时语句的输出未回传）。已知下界是「>120s」（否则不会超时），上界未知。该数字是判断「预算该抬到多少」的依据，留作 codex 平台侧自测项，本轮不补测（BP-3 三问：不为本轮判据之外的读数额外开一轮）。
