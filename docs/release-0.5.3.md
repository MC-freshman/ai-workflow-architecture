# Architecture Manager 0.5.3 使用说明（锚定代与一键对齐）

本版回答的是"版本老是互相不匹配"这一类问题：**把工作区该用的那一套版本显式定义成一个锚定代，再让每个平台按一个事务对齐过去，对齐后由该平台自己重跑检查并出可回读读数。**

## 一、这一版新增了什么

### 1. 锚定代（工作区级，机读）

- 位置：`<工作区>/versions/anchor.json`（点"生成锚定件"才写；与当前工作区逐字一致时**不写**）。
- 内容：engine / contracts / checker / judge / conformance 五轴 + software 的连接器、网关与六件配方指针，外加**落选账本**（每个候选版本自己的落选原因）。
- 生成规则（不盲拼"最新"）：引擎取"最新且带一次性调用接口、其声明的检查器存在且已冻结"的 `wf-runner`；**检查器就取该引擎声明的版本**（所以配对是构造出来的，不靠人工对齐）；判据取最新且带矩阵接口的 `architecture-ops`；契约 / 能力判据 / 软件取共享指针；**已发布但未采纳的候选不会被自动提升**。
- 在真实工作区（`E:\ai`）实跑得到的锚定代：`wf-runner 0.12.2 / runtime-contracts 1.5.2 / repo-lint 0.6.5 / architecture-ops 1.5.2 / platform-conformance 1.5.1 / _connector 1.0.7`，digest `1598a1834597…`。

### 2. 面板「锚定代与平台对齐」

- 位置：**平台与接入** 视图，接入向导下方。
- 「读取锚定代」：只读。列出各轴版本、锚定件是否已落盘/是否与工作区一致、每个平台的**逐键差异**（老值 → 新值）、以及落选账本。
- 「生成锚定件」：预览后确认才写 `versions/anchor.json`。
- 每个平台行的「预览对齐」：生成该平台的对齐计划，走**统一的计划预览与确认**（不新增写入通道）。计划只改版本键：平台的 runner / contracts / scannerRelease / invocationMatrixRelease + `bridge.json` 的 runner 引用与默认 `repo-lint`；**其它键逐字保留**。

### 3. 对齐后自动认证

确认执行后，管理台会：写入 → 回读（按锚重新解析该平台，逐键比对）→ **自动触发该平台自己的** conform + 受影响格矩阵（`mode=quick`）→ 记录结果。若本轮覆盖完整则固化首次认证；若只是部分覆盖，记录保持"待接入"，**不会**把部分结果写成完成。执行期失败会如实报"认证停在 X"，写入的配置保持有效。

### 4. 预检改为具名警告

`VERSION_PAIR_MISMATCH`（所选引擎声明的检查器 ≠ 所选检查器）**不再阻断接入**：改为具名警告写进计划与记录（`plan.warnings` / `target.pairing`），并**应用引擎声明的配对**；请求的版本只记录，不静默照办。

## 二、这一版修掉的两个会骗人的缺陷

1. **锚定件未落盘时，六个平台被报成"0 处差异 / 已对齐"**。现在对齐结果带 `materialised` / `compared`，**没有比较过就绝不显示已对齐**（面板显示"锚定件未生成"）。
2. **重复执行同一锚定计划会报基线不符**。现在字节已等于计划目标时报 `already-applied`，不写第二遍。

另外修正了落选账本：以前每个候选一律写"排在选中者之下"，现在**每个候选写自己的原因**（`NO_INVOCATION_SMOKE_INTERFACE` / `NO_MATRIX_SMOKE_INTERFACE` / `DECLARED_CHECKER_UNAVAILABLE:<版本>:<原因>` / `NOT_FROZEN:<原因>` / `STAGING_RELEASE_LABEL`）。

## 三、实测读数（本版）

| 项 | 读数 |
|---|---|
| 测试 | **200 通过 / 0 失败**（2 跳过），含 5 个新增测试文件 |
| 静态检查 | `eslint src scripts` 干净 |
| 前端构建 | vite 构建通过 |
| 真实工作区只读实跑 | 锚定代 = 上列五轴；六个平台全部如实报"未比较（锚定件未落盘）" |
| 事务分派端到端 | 两种新计划经 `applyPlan` / `verifyPlanTarget` 跑通；审计 `events.jsonl` 记为 `anchor-generation` / `platform-anchor-alignment`，均 `applied` |
| 中断回滚 | 对齐写到一半中断 ⇒ 已写文件逐字节还原 |
| 并发/外部改动 | 计划生成后配置被外部改动 ⇒ 拒写，外部改动原样保留 |

## 四、使用顺序（建议）

1. 打开工作区 → **平台与接入** → 「读取锚定代」：先看锚定代表与各平台差异。
2. 若锚定件"尚未落盘"：点「生成锚定件」→ 计划预览里确认执行。
3. 逐个平台点「预览对齐」→ 在计划预览里核对将改的键 → 确认执行。执行后会自动跑该平台的检查。
4. 需要"一键对齐全部平台"或"软件本体按锚导入"时，见下一版的批量面（本版未含）。

## 五、本版不含（诚实边界）

- **批量一键对齐**（一次对齐全部平台）未含；需逐平台确认。
- **软件本体的自动导入**未含：配方不发行本体，本体必须来自你指定的安装源。本版只显示软件键的声明状态（网关/运行位/环境），不代你绑定本体。
- **没有翻任何共享指针**，**没有改任何其它平台的配置**；本版只在管理台仓内新增能力，等你确认后才对某个平台执行对齐。
- 对齐后的"首次认证"能否固化，取决于该平台自己那轮的检查是否覆盖完整；覆盖不全时按"待接入"如实记录。

## 六、本版产物（sha256）

| 产物 | sha256 |
|---|---|
| `Architecture-Manager-0.5.3-portable-x64.exe` | `4b1d59d786d3d78810dc34e170d7f49f47eba7f1a7a9dc0e48c15cba61642a14` |
| `Architecture-Manager-0.5.3-setup-x64.exe` | `096cbafdb15579a06d23605550b4a810f8d0c2fd3481a6d15ed36c2954d95a48` |

清单文件：`release/SHA256SUMS-0.5.3.txt`。

**打包方式说明**：本机 electron-builder 缓存里没有 Electron 44.5.0 的分发包，在线下载两次超时，最终用 `node_modules/electron/dist` 里的本地分发离线出包（`--config.electronDist=node_modules/electron/dist`）。产物已核对：`release/win-unpacked/resources/app.asar` 内含本版新增的四个标志串（`anchor-generation` / `platform-anchor-alignment` / `anchor:post-align-check` / `readAnchorReport`）。

