# E:\ai\software — 共享软件配方仓库

> 架构 3.0 第三共享仓库（与 `tool/`、`agent/` 严格同构）。
> 设立日期：2026-09-18（经用户授权）。
> 当前状态（**2026-09-21 回读，框架侧已实现并发布**）：**本仓的同构判据已闭合**——`software/registry.json`（`ai-software-registry/v1`）+ 逐配方 `current.json`（选择键唯一＝`version`；`updatedAt` 废除；`available` 只能是 `versions/` 枚举的缓存且必须相等；`hashManifest` 必填）+ `versions/<semver>/` + 双向 `SHA256SUMS` + `SOURCE.json`，并由 `repo-lint 0.4.0` 真校验（**六份已发布配方逐字不变即过新校验**＝旧资源零回归，是这一步的硬判据）。契约 `ai-software/v1` 不再是草案；引擎 `software-call` 已在 **`wf-runner 0.9.0`** 实现（八步门禁链 `declared → snapshot → profile → boundary → consent → arguments → idempotency → dispatch`，失败一律在派发前；幂等使重跑答 `replayed`）；**参考软件网关已发布首版 `software/_gateway/1.0.0`**（三类传输 + 平台内锁表 + `per-run`/`pooled`/`singleton`/`exclusiveResources`）。**发布 ≠ 采纳**：共享 `current` 一处未翻、qoder 生产仍钉 `wf-runner 0.7.7` 且其生产 config 不声明任何 software 键；`_gateway` 是共享程序件，故**不进本仓 registry**（registry 只列可被调用的软件）。基线 `versions/架构3.0.0.md`，账在 `versions/平台接入清单.md` §8.17，逐行证据 `qoder/runtime/maintenance/3.0-A/`。
> **仍然开放、不得读成已完成**：① 六个配方的 `capabilities.snapshot.json` **全部未冻结**（`frozen: false`）⇒ 软件调用按 C-4 答 `CAPABILITY_UNAVAILABLE` 并点名配方字段（**不报成漂移、不假绿**），冻结＝发新配方版本（不回改已发布件），本平台实测成本 ≈45 分钟（D-47）；② 仅 `windows.json` 一份 OS 配方而 `platformSupport` 声明三 OS ⇒ 校验产出登记级 finding `SOFTWARE_RECIPE_MISSING`、平台 `conform` 把该 OS 判 `declaredAbsent`（C-2）；③ `requiredProfiles` 命名卫生（`python>=3.8` 这类把版本写进名字的键）留待配方换代时处理（C-3 遗留）；④ 跨平台资源仲裁仍未满足（锁表在本平台 runtime 内）。

## 仓库定位

`software/` 存**软件配方**，不存软件本体。

- **配方（入库，可冻结，跨平台共享）**：manifest、能力快照、参数 schema、本体获取配方（recipe）、selftest、说明书。
- **本体（不入库，平台自管）**：可执行文件、运行时、依赖库、商业软件安装包——由各平台按 recipe 装进自己的 `runtime/software/`，记录实际哈希。

理由：本体跨平台、体积大、商业许可禁再分发、会撞密封哈希预算；配方轻量、纯文本、可版本化、可审计。

> **已知例外（唯一一格，2026-09-18 登记）**：`software/phpStudy_64/` **是软件本体**，不是配方——1178 文件 / 542.9 MiB，无 `current.json`、无 `versions/`、无 `manifest.json`、无 `SHA256SUMS`，仓内外零引用零占用。它是用户本人手工移植、并于 2026-09-18 明示「放着不管」的内容，因此作为**已登记的例外原地保留**（不搬、不删、不改）。登记正文在 `versions/平台接入清单.md` §8.4/§8.5。
>
> 使用约束：**不得把它当作配方模板仿照**；**不得随本仓对外发布、打包导出或整仓冻结分发**（其内嵌的 MySQL datadir 含一行用户在用账号的凭据形态记录）；本仓的「四重校验」当时**只覆盖 6 个配方目录**，不含"本体不入库"拒绝，这就是它能混进来的原因——所以架构 3.0 的 **P4 首位是实现发布/入库校验闸**（pointer+manifest+SHA256SUMS 齐备、BOD「本体不入库」拒绝、schema meta 校验），且该闸从出生起就要支持**带授权来源与日期的例外表**，否则它第一次运行就会拒绝仓库里唯一这格合法存量。

## 目录结构（与 tool/agent 同构）

```
software/<id>/
  current.json                 # ai-software-pointer/v1，指向当前版本
  versions/<semver>/
    manifest.json              # ai-software/v1，配方核心
    capabilities.snapshot.json # 能力清单冻结快照
    schemas/                   # 各能力参数/输出 JSON Schema
    recipes/
      windows.json             # Windows 平台本体路径与校验
      linux.json               # （可选）Linux 平台配方
    selftest/
      readonly.json            # 只读自检配置
    README.md                  # 说明书（并发与独占资源为必填章）
    SHA256SUMS                 # 配方密封哈希
```

## 仓级索引与指针同构（2026-09-20，架构 3.0 S-P2）

- `software/registry.json`（`ai-software-registry/v1`，与 `ai-tool-registry/v2`/`ai-agent-registry/v2` 同族）现在存在：六个配方逐件登记，条目字段与 `tool`/`agent` 完全同构（`{id, current, enabled, kind, invocable, transports}`）。`current` 是**指针文件的路径**，不是版本号。
- 指针一律用 **`version`** 选释放版（与 `tool`/`agent` 同一键），并带 `hashManifest: "SHA256SUMS"`；`available` 只作为 `versions/` 目录枚举的**缓存**（值必须等于实际清单），`updatedAt` 已废除。逐条裁定与理由写在 `registry.json` 的 `compatibility.axes` 里（七个轴，一个轴一个结论，不留"两种形态都对"）。
- 软件资源**不进 `/wf`+`/wfa` 调用面**：`invocable: false`、`transports: []`——配方只由引擎在 `software-call` 阶段经网关调用（C-5 / ENTRY-04 同一口径）。
- 上面那条例外（`phpStudy_64/`）不在 registry 里，也不被任何解析器看见：它没有指针、没有 `versions/`、没有 manifest。

## 首批入库配方（2026-09-18）

| ID | 显示名 | 上游版本 | 接入形态 | 并发 | 能力数 | 来源 |
|---|---|---|---|---|---|---|
| nmap | Nmap Network Scanner | 7.95 | cli-wrapper | per-run | 3 | <local-tool-body-path> |
| wireshark-cli | Wireshark CLI (tshark/editcap/mergecap) | 4.2.6 | cli-wrapper | per-run | 5 | <local-tool-body-path> |
| burp-suite | Burp Suite Pro (MCP) | 2024.5.1 | mcp-http | singleton | 4（2 待冻结） | <local-tool-body-path> V2024.5.1 |
| dirsearch | Dirsearch Web Path Scanner | 0.4.3 | cli-wrapper（python） | per-run | 2 | D:\Various_programming_languages\PPython\dirsearch-master |
| veracrypt | VeraCrypt Encryption | 1.26.7 | cli-wrapper | singleton | 4 | <local-tool-body-path> |
| mysql-cli | MySQL Client CLI | 8.0.39 | cli-wrapper | per-run | 3 | <local-tool-body-path> |

合计 21 个能力。每个配方版本目录含 7 类文件：`manifest.json` / `capabilities.snapshot.json` / `schemas/*.json`（共 39 个正式 draft-07 schema）/ `recipes/windows.json` / `selftest/readonly.json` / `README.md`（含 argv 映射表）/ `SHA256SUMS`。

## 「框架就绪」具体包含什么（2026-09-18）

- **机械可渲染的调用映射**：cli-wrapper 每个能力在 `manifest.capabilities[].invocation` 内声明 `executable / baseArgv / argMapping`，argMapping 用一组固定样式（positional / flag / boolean / boolean-value / repeat / flag-concat / passthrough，支持 join / default / enum / required / position / appliesWhen / conflictsWith），网关无需理解软件语义即可把 JSON 入参渲染成 argv 数组。已用干跑器对全部 cli 能力验证渲染正确。
- **MCP 路由**：mcp-http（burp-suite）用 `transport/endpoint/mcpMethod/toolNameParam/healthCheck` 声明，参数整体透传 `tools/call`。
- **四段 recipe**：acquire（来源/许可/可否再分发）、install（detectedPath/pythonPath 等）、launch（startup.command+args+environment、postStartupManualSteps、readyProbe）、verify（versionCall/versionProbe + files[].sha256）。
- **凭据不落 argv 明文**：mysql 用 `credentialHandling.injectArgv`（临时 `--defaults-extra-file`，用后即删）；veracrypt/burp 用密钥位引用并在 README 点明上游 argv 暴露限制。
- **可执行只读自检**：version/file-integrity 随时可跑；burp 端点不可达记 SKIP（软件未启动）而非 FAIL；高影响能力永不纳入自动自检。
- **四重校验全绿**：① 69 个 JSON 合法、current 指针与 SHA256SUMS 匹配（75 项）；② 39 个 schema 通过 draft-07 meta 校验，正样例通过、7 个负样例（缺必填/互斥/数量下界/空边界）被正确拦截；③ 12 个 cli 能力 manifest↔schema 参数名零漂移；④ 全部能力 argv/MCP 干跑渲染通过。

## 关键设计原则

1. **配方/本体分离**：仓库只存文本配方，本体由平台按 recipe 定位/校验/启动。
2. **同构切换**：`current.json` + `versions/` + `SHA256SUMS`，与 tool/agent 完全一致；`switch_defaults.py` 已按 `entry["repo"]` 仓库无关设计，software 天然受一句话切换支持。
3. **能力声明驱动**：manifest.capabilities 声明每个能力的 sideEffects / consent / idempotent / safeForSelftest，引擎按声明执行门禁。
4. **并发机读+人读双份**：manifest.concurrency（instanceMode / exclusiveResources / whenBusy）是发布必填字段；README「并发与独占资源」章是人读说明。不能并行的必须在两处点明。
5. **平台自补缺口**：框架只交付契约、参考网关、mock、矩阵、指南；平台缺传输适配器就自写（过契约测试即 PASS）、缺本体就自建、不支持就登记 EXPECTED，全程不需要框架发版。
6. **三仓对称是硬判据（BP-1 / BP-2）**：`software` 与 `tool`/`agent` 必须对称到**同一判据面**——registry、`current` 指针、逐版本 `SHA256SUMS`、依赖锁钉版、一句话切默认、平台 config 内容根（`softwareRoot`）、jail 内只读绑定（`/shared/software`）。当前实状：六平台 `bridge/` 对本仓**零引用**、引擎动作枚举仍是 `["prompt","script"]`、本仓**尚无 `registry.json`**（清单只写在下面这张表里）。**这些属"接入未完成"，须列待补台账，不得表述为设计如此或平台自愿**；能力缺位记 `declaredAbsent` + 补齐路径，不得写成平台永久分层。
7. **验收最小量 + 跨平台仲裁（BP-3 / BP-4）**：新增或换代单个配方 = 索引追加 + `conform --only <id>` 单格冒烟，不重跑全矩阵、不重复认证未变配方；singleton / `exclusiveResources` 型软件（burp-suite / veracrypt 及任何占固定端口、设备、席位、datadir 者）的互斥键必须**在所有平台之间**有效——单平台网关内的锁表不算跨平台仲裁，仲裁器落地前不得允许两个平台同开同一项目的 run。
8. **分步实施与完成判定（BP-5）**：配方新增/换代与平台重接入轮**进入执行前先给有序 P 步表**（单个 P 约 2–3 小时墙钟，内含 2–4 个各带可中断点的子块，最小格式见 `versions/架构基本原则.md` §5.1–5.3 与 §5.8；3.0 方案 §13 的 `P0–P10` 是工序序，不满足该时限口径，开工前须重新切块）；**验收判据在方案定稿时冻结**，执行期不得追加验收项或提高门槛；执行期发现的非阻断缺陷**只做登记**、收口后统一另出一份修复方案（另立 P 表）；**P 表全部按预定判据跑完且产出物可回读即＝更新完成**，等待型观察项归完成后的维护期。

## 调用语义（3.0 首版：编排式）

agent 不会"自己随便用"软件。软件调用由工作流的 `action: software-call` 阶段显式声明（software / capability / arguments），引擎 prepare 时校验依赖闭包、平台对齐、能力快照、权限/确认/边界，next 派发过网关，submit 留证。

自主式调用（agent 在 prompt 阶段经许可自由调用软件）列为 3.1 可选增强，3.0 首版不做。

## 待办

- [x] 各能力参数 schema 从占位细化为正式 schema（首批 6 个，39 个 schema）
- [x] cli-wrapper 声明式 argv 映射、mcp-http 路由、四段 recipe、完整哈希与四重校验
- [ ] **burp-suite 快照冻结（人工，阻塞项）**：实机启动 Burp + MCP 扩展（127.0.0.1:9876）后跑 tools/list，回填 proxyHistory/scannerScan 的 frozenToolName 与 nativeName，snapshot.frozen 置 true，发新版本配方
- [ ] `ai-software/v1` 契约正式化（把本轮反推的 invocation / 四段 recipe / selftest 字段回写为契约规范）
- [ ] 引擎 wf-runner 新增 `action: software-call`（3.0 实施）
- [ ] 平台 software-gateway 参考实现（mcp-stdio / mcp-http / cli-wrapper）
- [ ] 矩阵新增 C6（并行）/ C7（单例串行化）/ SOFTWARE_DRIFT（本体漂移检测）
- [ ] **（BP-1 对称）** `software/registry.json`（`ai-software-registry/v1`）实建——现在清单只存在于本文件的表格里，三仓里只有本仓没有注册表
- [ ] **（BP-1/BP-2 对称）** 各平台 config 增 `softwareRoot`、jail 内增 `/shared/software` 只读绑定（与 `tool`/`agent` 同批），并逐平台各自出证、结论不互抄
- [ ] **（BP-4 ③）** singleton / `exclusiveResources` 型软件的**跨平台仲裁器**（中立位置、与平台无关的键名、跨并发分支合法且无撕裂）——未落地前不得允许两平台同开同一项目的 run
- [ ] **（BP-3）** 验收收敛成单条 `conform` 命令出 pass/fail digest，支持 `--only <software-id>` 增量冒烟；未变配方按内容哈希沿用既有 attestation
- [ ] 更多软件配方入库（按 3.0 方案推荐清单）

## 参考

- 架构 3.0 方案：`E:\ai\versions\架构3.0-software整合提案-20260917-v2.md`
- 调用适配器规范：`E:\ai\invocation-adapters-spec.md`
- 总框架入口：`E:\ai\HANDOFF.md`

## 3.1.0 对本仓的影响（2026-09-23 登记）

- **配方判据一字未改**：`repo-lint 0.5.1` 沿用 SW1~SW5 与 `registry.json` + 逐配方 `current.json` + 双向 `SHA256SUMS` 的同构形态；本轮新增的是**定义代与场景**，不涉及软件配方，六份已发布配方逐哈希未变。
- **单格冒烟走 `conform --only <softwareId>`**：`platform-conformance 1.4.0` 起，`--only` 接受逗号多选并**逐条判定**；打错一个 id 或窄化后一行都没判定时**命令退出码非零**（此前 `emptyRowSet` 只写进报告、退出码仍是 0，属 D-32 的假绿）。整条命令仍是 0.1 s 量级。
- **矩阵软件行的解释器按三级回退**（D-59）：运行器 `config.interpreters[<suffix>]` → 网关 config 里的 `interpreters`/`python` → harness 自身进程的解释器，并把**哪一级供给了**写进行（`interpreterFrom`）。只带网关 config 的平台从此也能起软件行；读到 `sys.executable` 就说明本平台没显式钉过，不得当成已声明。
- **合并与新增不得给平台造新欠账**：收拢流程时若自创权限三元组等平台未声明的项，`conform` 的并集会多出一格 `declaredAbsent`（实测 D-80）。软件面同理——新增配方声明能力前，先看本平台 `capabilities.json` 有没有对应项；没有就按 BP-2 记时间差并给整数分钟成本，不要靠 `expectedAbsent` 之类措辞刷绿。
- **仍未裁的方向**：用户 2026-09-22 给的软件面目标形态（经连接器 / MCP 链接调用，而不是平台起真 CLI 子进程）在本轮**只登记未实施**；`_gateway` 仍是已发布的 `1.0.0`，三态可回读目前只落在 run 侧 `software-intents/*.json`（D-76），D-60 的可派发落差留给那一轮一并裁定。
