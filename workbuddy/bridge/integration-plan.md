# WorkBuddy 平台接入实施方案 v1.0

> 制定者：workbuddy 会话，2026-09-16。维护者：仅 **workbuddy 会话**。总框架：[../../HANDOFF.md](../../HANDOFF.md)；接口与判据：[../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §8 / §9 / §10；八步清单：[../../versions/平台接入清单.md](../../versions/平台接入清单.md)；平台章：[platform.md](platform.md)；调用手册：[invocation-manual.md](invocation-manual.md)。
>
> **状态：S1–S8 已全部执行完毕（2026-09-16），接入判据达成——矩阵 r3 `PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0`（40 行，`../runtime/matrix-smoke/workbuddy-matrix-20260916-r3.json`，分片执行 provenance 随报告留档）。** 平台章已更新为"第 7 运行平台"。

---

## 0. 用户四条硬性要求对照（本方案的存在理由）

| # | 要求 | 共享框架现状（不需要改） | WorkBuddy 满足路径 | 落点 |
|---|---|---|---|---|
| 1 | 所有 tool 走 `/wf`、所有 agent 走 `/wfa`，格式保证一致 | 共享语法已统一（规范 §8）：`/wf <workflow-id> [任务描述]`、`/wfa <agent-id> [任务描述]`；当前 38 个业务资源（25 工作流 + 13 专家）全部走该语法 | ① WorkBuddy **有技能面**（用户级 Skill 目录），注册 `/wf` `/wfa` 两个入口（比 doubao 的纯 CLI 直调更强，为 A2 + A4 双通道）；② Skill 文本与 zcode `commands/wf.md`、`commands/wfa.md` 语义逐条对齐，仅适配平台路径与解释器；③ Skill **不硬编码 runner/contracts/tool/agent 任何版本号**，一律从 `workbuddy-config.json` 与共享 `current.json` 解析，杜绝 zcode 命令文件曾出现的版本 stale 问题 | [invocation-manual.md](invocation-manual.md) §2；[../skills/wf/SKILL.md](../skills/wf/SKILL.md)、[../skills/wfa/SKILL.md](../skills/wfa/SKILL.md) |
| 2 | 架构无须担心平台能否接入，架构只提供"接口" | 规范 §9 即此原则："共享侧只定义接口与校验，不假定任何平台的实现方式；平台能力必须由平台声明" | WorkBuddy 全部改动限定在 `E:\ai\workbuddy\`（配置、能力声明、运行产物、Skill 源文件）+ 共享**文档**的状态注记（spec 增补行、平台接入清单注记）；**零改动** `tool/`、`agent/` 仓库内容、引擎、共享 `current.json` | 本方案全文；§4 红线 |
| 3 | tool/agent 更新后，在平台内说"该 tool/agent 已更新，请将默认设置为新版本"即可用新版 | 共享 `current.json` 指针机制 + 平台零配置跟随（zcode / qoder / doubao 均实测 `check_follow` 零漂移） | ① WorkBuddy 配置**不硬编码任何 tool/agent 版本**，解析顺序 = 显式版本 → 共享 `current`；② "换代跟随协议"写入手册 §4：用户一句话 → 会话五步动作（盘点 → 校验 → 切换/跟随 → 冒烟 → 汇报），含"新版本目录已发布但共享 current 未切"的授权切换路径 | [invocation-manual.md](invocation-manual.md) §4 |
| 4 | tool/agent 相互独立、可并行；不能并行的须在说明书中点明 | 规范 §10 并发结论表是唯一权威：不同 run 之间**可以**并行（doubao C1/C2 已实测）；tool 与 tool、agent 与 agent 互不影响 | ① 手册 §5 全文收录 §10 结论表，并**逐条点明 5 类不可并行场景**；② WorkBuddy 自己实测 C1/C2 两 run 并行（步骤 S7），不照抄他平台结论 | [invocation-manual.md](invocation-manual.md) §5 |

**两条例外面（全平台一致，按"点明"处理，不硬凑绿）：**

1. `wf-runner`——引擎自身，自调用成环，**设计例外**，不承诺 `/wf` 语义（规范 §8）。
2. `repo-lint`——声明 `filesystem=shared-read-only-platform-report-write`。**候选能力（可选，实测通过后才可声明）**：WorkBuddy 会话具备全盘只读能力，若在 S3 为脚本阶段提供"共享根只读 + 写域限定平台 runtime"的执行方式并实测通过，则 WorkBuddy 可声明该策略、使 `repo-lint` 成为可调用资源（这将优于现有一切平台）；**未实测前**一律按 EXPECTED 例外登记（与 zcode/qoder/doubao 口径一致），不得谎报。

## 1. 目标终态

```
用户（WorkBuddy 会话内）
  ├─ /wf <workflow-id> [任务描述]   → Skill(wf)  → 读 workbuddy-config.json → runner cli.py → prepare→next→submit→stop
  ├─ /wfa <agent-id> [任务描述]     → Skill(wfa) → 同上（target.mode=agent，工作流由专家 tool-lock 决定）
  └─ "该 X 已更新，请将默认设置为新版本" → 手册 §4 换代跟随五步 → 后续调用即用新版
所有运行产物只落 E:\ai\workbuddy\runtime\runs\<run-id>\
共享侧（tool/agent/wf-runner/repo-lint/current.json）零改动、只读
```

## 2. 执行步骤（S1–S8）

> 顺序铁律（平台接入清单 §2）：**先声明能力（S3），再启用引擎调用（S4）**。0.6.0 引擎下未声明 `permissionAdapters` 就调用 = 每次 prepare 被拒（`Required permission policy has no verified adapter`）。

### S1 建平台 Python 运行环境（venv）

| 项 | 内容 |
|---|---|
| 动作 | 用系统 Python 3.9.13（`D:\Various_programming_languages\pycharm\python3.9\python.exe`，与 doubao 验证基线同构）建 venv：`E:\ai\workbuddy\runtime\py-env`；按 `E:\ai\tool\wf-runner\versions\0.6.0\requirements.lock` 逐版本安装 8 个依赖库；另装 matplotlib（renderer profile 需要，版本对齐 doubao 的 3.9.4 / numpy 1.26.x） |
| 命令 | `python -m venv E:\ai\workbuddy\runtime\py-env` → `py-env\Scripts\pip install -r <requirements.lock 转换的包清单> matplotlib==3.9.4 numpy==1.26.x` |
| 产出 | `runtime\py-env\`、`bridge\environment.json`（逐包钉版清单，格式对齐 `doubao\bridge\environment.json`） |
| 判据 | `py-env\Scripts\python.exe -c "import <8 库逐一 import>"` 全部成功；matplotlib Agg 出图成功 |
| 备选 | 若 requirements.lock 与 3.9.13 不匹配，改用 managed Python 3.13.12（`<local-user-path> environment.json 记录实际版本 |
| 回滚 | 删除 `runtime\py-env\` 即可，无外部副作用 |

### S2 落盘引擎配置 workbuddy-config.json

| 项 | 内容 |
|---|---|
| 时点 | S1 完成后（配置引用 venv 路径） |
| 动作 | 新建 `E:\ai\workbuddy\bridge\workbuddy-config.json`（模板见 §3.1）；现有 `bridge\bridge.json`（架构 §九要求的共享声明面）**保持不动** |
| 判据 | 路径全部存在：runner 0.6.0 目录（含 manifest.json + SHA256SUMS）、contracts 0.2.1 目录、runsRoot 目录 |
| 红线 | 不改 `tool\wf-runner\`、`tool\repo-lint\` 任何文件；不跟随共享 current 切引擎（引擎钉版是平台自决，两套机制） |
| 回滚 | 删除该文件即回到空架子状态 |

### S3 能力自证并落盘 capabilities.json（先于任何调用）

逐项**实测后**才能置 `true`，全部对齐 doubao 的 capabilities 结构（schema `ai-platform-capabilities/v1`）：

| 声明项 | 自证方法（全走 PowerShell；本机 bash 不可用） | 判据 |
|---|---|---|
| `checks.python-runtime` | venv 解释器跑 `python -c "print('ok')"` | 退出码 0 |
| `checks.runner-dependency-resolution` | S4 冒烟 prepare 成功即证 | prepare 返回 ok |
| `checks.filesystem-platform-scoped-write` | 写 `runtime\runs\probe\` 测试文件 | 写成功且仅落平台目录 |
| `checks.shared-repo-read-only-access` | 读 `tool\registry.json`、`agent\registry.json` | 读成功、无写操作 |
| `checks.shell-command-execution` | PowerShell 执行任一命令 | 退出码 0 |
| `checks.runner-protocol-prepare` / `prompt-stage-claim` / `prompt-stage-submit` / `terminal-stop-with-evidence` | S4 真实闭环 `prepare → next → submit → stop`（game-sprint-plan 2.1.1，三阶段连续 completed） | state 终态 + evidence 齐 |
| `permissionAdapters` | 声明业务三元组 `{filesystem: project-scoped, network: deny, process: allowlisted-only}`；evidence 按 doubao 分面口径如实写：prompt 阶段 = 会话自律（WorkBuddy 会话具备网络与任意命令能力），脚本阶段见 scriptEnvironment 缺口 | 与工作流声明策略完全相等才可写 |
| `profiles.renderer` | venv 内 matplotlib Agg **真实出图**到 `runtime\renderer-selftest\render.png` | PNG 生成且非空 |
| `declaredAbsent` / `unverified` | `scriptEnvironment`（无内核级隔离沙箱 → `action:script` 阶段与 `--tool render-figure/record-visual-review` 不可执行）、`peerDispatch`（不声明、checks 不放 false）、`mcp-tool-surface`、未实测项（进程门禁 / 崩溃恢复 / C3-C5） | 如实登记，不掩盖 |

**例外候选（可选加分项，不承诺）**：若 S4 后有余力，为 `repo-lint` 的脚本面做"只读共享根 + 写域限平台"实测；通过才追加声明该策略适配器，未通过保持 EXPECTED。

| 时点/判据/回滚 | 内容 |
|---|---|
| 判据 | `checks` 内无 false（负面能力一律进 declaredAbsent/unverified，`all(checks.values())` 是运行前置门禁）；每个 true 都有 evidence 指向实测产物路径 |
| 回滚 | 删除 capabilities.json；已写声明不得与实测矛盾 |

### S4 真实闭环冒烟（首次调用引擎）

| 项 | 内容 |
|---|---|
| 动作 | 会话手工执行一次完整业务闭环：`game-sprint-plan 2.1.1` 的 `prepare → next → submit`（intake / capacity / plan 三阶段连续 completed）`→ stop`；再执行专家闭环：`agent:novel-writer@1.4.0` 经 tool-lock 解析主工作流后 `prepare → next(prompt) → stop` |
| 命令 | `E:\ai\workbuddy\runtime\py-env\Scripts\python.exe -B E:\ai\tool\wf-runner\versions\0.6.0\cli.py --config E:\ai\workbuddy\bridge\workbuddy-config.json --request <request.json>`；环境变量 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`PYTHONDONTWRITEBYTECODE=1`（否则中文 prompt 乱码 / 向只读发布目录写 `__pycache__`） |
| 产出 | `runtime\runs\workbuddy-submit-smoke-<date>\`、`runtime\runs\workbuddy-agent-smoke-<date>\`（run-lock 钉 `platform=workbuddy`） |
| 判据 | 两闭环终态 + `doctor.py --platform workbuddy` 报 `ok:true` 零 blockers（doctor 2026-09-13 已对 workbuddy 实测过探测，无需改登记） |
| 回滚 | run 目录保留作为证据；失败按手册 §3 错误语义排查，不改共享侧 |

### S5 入口注册（/wf /wfa）

| 项 | 内容 |
|---|---|
| 动作 | ① Skill 源文件已存档于 `E:\ai\workbuddy\skills\wf\SKILL.md`、`E:\ai\workbuddy\skills\wfa\SKILL.md`（本方案批次完成）；② 执行轮经用户确认后**复制**到用户级发现位置 `<local-user-path> |
| 判据 | 新 WorkBuddy 会话内 `/wf` `/wfa` 可被识别；空跑一次参数解析；文本与 zcode 命令逐条语义对齐（仅平台路径/解释器/PowerShell 差异） |
| 红线 | Skill 文本不含任何版本号硬编码；数模例外条款写入（见 skill 文件第 2 条） |
| 回滚 | 删除用户级两目录即卸载；源文件不受影响 |

### S6 矩阵验收（接入判据）

| 项 | 内容 |
|---|---|
| 动作 | 跑机械矩阵，逐资源 `prepare → next → stop`（脚本阶段默认不真跑） |
| 命令 | `E:\ai\workbuddy\runtime\py-env\Scripts\python.exe -B E:\ai\tool\architecture-ops\versions\1.2.0\architecture_ops\invocation_matrix.py --config E:/ai/workbuddy/bridge/workbuddy-config.json --out E:/ai/workbuddy/runtime/matrix-smoke/workbuddy-matrix-<stamp>.json --exceptions E:/ai/workbuddy/bridge/invocation-exceptions.json --runs-root E:/ai/workbuddy/runtime/matrix-smoke/<stamp>` |
| 判据 | **`PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0`，退出码 0**；非 PASS 项按实测错误码逐条登记 `bridge\invocation-exceptions.json`（预期两条：wf-runner 设计例外、repo-lint 策略缺口；若实测出现新 FAIL，先排查本平台配置，禁止放宽判定凑绿） |
| 达成后 | 更新 `platform.md` 状态行、`HANDOFF.md` §三 workbuddy 行、spec §2 矩阵表、平台接入清单 §4 表（由 workbuddy 会话改自己的记录） |
| 回滚 | 失败不留"已接入"字样；保留矩阵 JSON 作诊断证据 |

### S7 并行实证（对应要求 4）

| 项 | 内容 |
|---|---|
| 动作 | C1/C2：`game-sprint-plan 2.1.1`（run A）与 `game-brainstorm`（run B）**并行** `prepare → next → stop` |
| 判据 | 两 run 均 ok、互不影响（§10 "不同 run 之间可以并行" 的 WorkBuddy 实测）；产物落 `runtime\runs\workbuddy-cc-a|b\` |
| 说明 | 同一 run 并发写（C3 类）为引擎守卫契约，不做破坏性实测，以 §10 表为准 |

### S8 换代跟随验证（对应要求 3）

| 项 | 内容 |
|---|---|
| 动作 | ① 跑 `runtime\check_follow.py`（照抄 doubao 用法）：矩阵全部行从共享 current 解析、版本零漂移；② 演练手册 §4 五步动作一次（用任一已发布资源，选"仅确认跟随、不实际切换"的安全路径） |
| 判据 | 零漂移报告落 `runtime\`；五步动作每步有留痕 |
| 说明 | 本步骤验证"用户一句话切默认"协议可执行；真实切换永远等用户发话 |

## 3. 配置模板

### 3.1 workbuddy-config.json（S2 落盘）

```json
{
  "platform": "workbuddy",
  "contracts": "E:\\ai\\tool\\repo-lint\\versions\\0.2.1",
  "toolRoot": "E:\\ai\\tool",
  "agentRoot": "E:\\ai\\agent",
  "bridge": "E:\\ai\\workbuddy\\bridge\\bridge.json",
  "runner": "E:\\ai\\tool\\wf-runner\\versions\\0.6.0",
  "capabilities": "E:\\ai\\workbuddy\\bridge\\capabilities.json",
  "runsRoot": "E:\\ai\\workbuddy\\runtime\\runs",
  "platformRoot": "E:\\ai\\workbuddy",
  "inputRoots": ["E:\\ai"],
  "notes": "workbuddy 平台显式钉版（2026-09-16 方案定稿，S2 落盘）：runner wf-runner 0.6.0、contracts repo-lint 0.2.1（契约 platform 枚举已含 workbuddy）。引擎选版与共享指针（wf-runner current 0.5.2）是两套机制，本平台钉版不改动任何共享默认。tool/agent 业务版本不在此文件钉——解析顺序为显式版本 → 共享 current，保证用户一句话换代跟随（invocation-manual.md §4）。未设置 scriptEnvironment / peerDispatcherModule 的后果见 capabilities.declaredAbsent。"
}
```

### 3.2 capabilities.json

结构完全对齐 `doubao\bridge\capabilities.json`（schema `ai-platform-capabilities/v1`；checks / permissionAdapters / profiles / attested / declaredAbsent / unverified / permissions / notes 八段）。模板要点见 S3 表；**S3 实测前不得落盘**。

### 3.3 invocation-exceptions.json（S6 产出）

格式对齐 `doubao\bridge\invocation-exceptions.json`：每条含资源 id、错误码、类别（设计如此 / 平台能力缺口）、证据路径、登记日期。

## 4. 红线（全程有效）

1. 不改 `tool/`、`agent/` 任何已发布版本与共享 `current.json`（除非用户对某次切换显式发话，且按手册 §4 流程留痕）。
2. 不改其他平台目录（含 zcode 的 ops 脚本，只读执行）。
3. `checks` 只增实证项；负面能力进 `declaredAbsent`/`unverified`；未验证不得写成已具备；非交稿不得称为已验证或已冻结。
4. 数模档位：未写 = **草稿**（不 INIT 已有项目、不重跑求解器、不冻结）；WorkBuddy 无脚本隔离环境 → **求解器链不承接，交稿级转 zcode**。
5. 共享仓库发布目录内不写任何缓存/日志/运行产物（venv、runs、matrix-smoke 全部在 `E:\ai\workbuddy\runtime\` 内）。
6. E:\ai 根只做文档注记，不新增一级目录。

## 5. 产物与状态对照表（执行后实测）

| 文件 | 状态 | 证据 |
|---|---|---|
| `bridge\integration-plan.md` | ✅ 本文件（状态行已更新） | — |
| `bridge\invocation-manual.md` | ✅ 全部条目已生效 | 状态头已改 |
| `skills\wf\SKILL.md`、`skills\wfa\SKILL.md`（平台内存档） | ✅ 已复制到用户级（哈希一致） | `runtime\logs\s5-install.txt` |
| `bridge\workbuddy-config.json` | ✅ S2 落盘 | 目录完整性 `runtime\logs\s2-dirs-check.txt` |
| `bridge\capabilities.json` | ✅ S3 实测落盘（S4/S6 后回填 attested） | 导入 20/20、渲染 35938B、写探针 |
| `bridge\environment.json` | ✅ S1 产出 | `runtime\logs\s1-import-check3.txt` |
| `bridge\invocation-exceptions.json` | ✅ S6 产出（r3 修订 wf-runner 指针版本为 0.5.2） | 两条 EXPECTED 错误码实测一致 |
| `runtime\py-env\` | ✅ S1 | python 3.9.13 + 20 包 |
| `runtime\runs\workbuddy-submit-smoke-20260916\` | ✅ S4 工作流闭环（三阶段 completed → stopped） | run-lock 钉 platform=workbuddy |
| `runtime\runs\workbuddy-agent-smoke-20260916-r2\` | ✅ S4 专家闭环（INTAKE prompt 含专家上下文 → stopped） | tool-lock 解析证实 |
| `runtime\renderer-selftest\render.png` | ✅ S3 渲染自证 | 35938 字节 |
| `runtime\matrix-smoke\workbuddy-matrix-20260916-r3.json` | ✅ S6 判据：38 PASS / 0 NEEDS-INPUT / 2 EXPECTED / 0 FAIL | 38 分片 + provenance；整版尝试 r1@20、r2@24 留证 |
| `runtime\runs\workbuddy-cc-a|b-20260916\` | ✅ S7 C1/C2 并行（六步交错全 ok） | `runtime\logs\s7-cc-report.json` |
| `runtime\check-follow-result.json` + `runtime\maintenance\generation-follow-drill-20260916.md` | ✅ S8 零漂移 + 五步演练 | `runtime\logs\s8-*` |
| `runtime\reports\doctor-20260916-workbuddy.txt` | ✅ doctor ok:true 零 blockers | — |

执行中的坑（留档）：① PowerShell stdout 不回传 → 全部"落盘后 Read"；② 本会话沙箱限制单条命令子进程总量，整版矩阵两次被终止（r1@20 / r2@24）→ 改 `--only` 分 38 片执行后机械合并，provenance 如实记录；③ `wf-runner` 资源行经共享 current 解析为 0.5.2，例外登记须按资源指针版本写（0.6.0 是引擎钉版，两套机制）；④ `expert-task` inputSchema 要求 `objective`（≥20 字符），`entrypoint` 会被拒——引擎校验行为正确。
