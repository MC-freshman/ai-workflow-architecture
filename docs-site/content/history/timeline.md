# 架构演进时间线

按日期记"哪天定了什么、哪天跑了什么"。**每条都给出可以在本站回读的页面**；日期与结论取自各文档自己的定稿注记与 `平台接入清单.md` 的分节账，不在此重述条文。

## 2026-09-07 → 09-14 ｜ 工作流体系成形

- 主方案序列 Phase 0 → 1 → 5A → 2 → 3 → 4 执行完毕；赛后把未完成项合并成收口台账（→ [赛后收口清单](/docs/history/post-competition-closeout)）。
- 2026-09-14 三道门 G1 / G2 / G3 闭合；总手册统一为"统一版 v2.0"（→ [Agentic Workflow 总手册](/docs/quick-start/master-manual)）。

## 2026-09-15 ｜ 架构 1.0.0 定稿

- 接口、不变量与四条验收结论定稿；平台表 09-17 按实测修订（→ [架构 1.0.0](/docs/architecture/1.0.0)，**冻结历史基线**）。
- 当日发布边界与接入状态两份补件（→ [发布边界](/docs/architecture/1.0.0-release-boundary)、[接入状态](/docs/architecture/1.0.0-integration-status)）。
- 判据口径：接口可调用（prepare→next→stop），**不是**业务跑完。

## 2026-09-16 → 09-17 ｜ 平台逐个升格

- `qoder`（09-15 按八项接口接入）、`doubao`（09-16）、`workbuddy`（09-16）依同一判据升格；`codex` / `zcode` 在先。
- 09-17 `zcode` 重建：矩阵读数不变，但脚本沙箱 / peer / MCP / 数模求解链**未恢复**——该缺口按 BP-2 记作 zcode 的待补项，不是别人长期绕行的理由。
- 同期两份演进提案（→ [2.0→3.0 提案](/docs/history/proposal-2.0-3.0)，其验收段与平台分层**与 BP-2/BP-3 冲突，只作留档**）。

## 2026-09-18 ｜ 架构 2.0.0 定稿 + `software` 仓设立 + BP-1~4 确立

- 四条硬门按 zcode / qoder **各自证据**成立（不互抄）；引擎新增 `executionBackend` / `scannerRelease` / `projectWriteRoots` / `peerDispatcherModule` 四键，独立契约包 `runtime-contracts 1.1.0`（→ [架构 2.0.0](/docs/architecture/2.0.0)）。
- **带偏差定稿**：四门未在两平台全绿、观察窗口未走完 → 见其 §10。其 §9 平台表与 §10 归属表**至今仍是平台接入状态的现行载体**。
- 同日 `software` 经用户授权设立为第三共享仓（只放配方，不放本体）；配套 [迁移指南](/docs/architecture/2.0.0-migration) 与 [恢复手册](/docs/architecture/2.0.0-recovery)。
- **BP-1 ~ BP-4 经用户授权写入全部治理文档**（→ [基本原则](/docs/architecture/basic-principles)）。

## 2026-09-19 ｜ 共享 `current` 切换 · qoder 接入面灭失与重出证 · 两轮修复

- 共享 `current` 切换（`wf-runner` / `repo-lint` / `runtime-contracts`），**切的是指针，不是字节**。
- qoder 生产接入面灭失 → 按 2.0-F 还原配置面、2.0-G 重出证（jail 边界、门1 真 script 阶段到 `succeeded`、门2 负向面 + `platform-conformance`、矩阵 `FAIL 0`）；09-18 那批 baseline 一手证据**永久不可回读**，只作文档转述。
- **2.0-H 框架收口轮**：把 2.0 的账分成框架与平台两类，平台侧一律移交各平台自证。
- **2.0-X 修复轮**：发布 `wf-runner 0.7.9`、`architecture-ops 1.1.0`、`platform-conformance 1.1.0`（判据 harness 首次成为共享版本件）。
- 同日新增 **BP-5 分步实施与完成判定**（→ [2.0.x 框架收口与修复方案](/docs/history/2.0.x-framework-closeout)）。

## 2026-09-19 → 09-20 ｜ 架构 2.1.0（2.1-A，框架侧）

- 按 [2.1.0 定稿实施表 P1…P9](/docs/history/2.1.0-final-plan) 逐行跑完，发布 `wf-runner 0.8.0`、`runtime-contracts 1.2.2`、`platform-conformance 1.2.0`。
- 三件关键变化：**A 轴三档 rigor**（门禁/密封/往返按档增减，功能面三档一视同仁）、**每 run 一次权威环境哈希后增量复用**、**§3.2 脚本执行降级阶梯**（主机一档必须当次同意）。
- D-27 两面闭合；BP-4 三机制（交接包 / 续跑版本校验 / exclusive 仲裁键）落进契约。
- **发布 ≠ 采纳**：共享 `current` 一字未翻，qoder 生产仍显式钉 0.7.7（设计来源 → [2.1.0 更新方案](/docs/history/2.1.0-update-plan)）。

## 2026-09-20 → 09-21 ｜ 架构 3.0.0（3.0-A 框架侧 ＋ 3.0-Q 平台侧）

- 09-20 深夜用户授权 **BP-6 入库先行** 与 **BP-7 不可入库件隔离与备份**，09-21 落笔（`基本原则` 升到 1.2），`inbox` 自此分备份/归档/垃圾桶三区。
- **3.0-A（框架侧）**：按 [S-P1…S-P9 ＋ 裁定 C-1…C-9](/docs/architecture/3.0.0-final-plan) 跑完，成稿 [架构 3.0.0](/docs/architecture/3.0.0)（→ 基线文件；设计来源 [software 整合提案 v2](/docs/history/3.0-software-proposal)）。
  - `software` 变成真正同构的第三仓；`repo-lint 0.4.0` 第一次"看得见"软件仓，**六份已发布配方逐字不变即过新校验**＝旧资源零回归。
  - 引擎新增 `software-call`（八步链、幂等重放、漂移两半）；参考软件网关 `_gateway 1.0.0`；C6/C7 并发实测。
  - 发布六件、零改写已发布字节、**零指针切换**。
- **3.0-Q（qoder 平台侧）**：用户指令"重新将 qoder 完整接入 3.0.0"，按 [Q-P1…Q-P6](/docs/architecture/qoder-3.0-q) 出判据。
  - 本平台生产采纳 3.0 栈（引擎 + 契约 + scannerRelease + 平台默认 `repo-lint` 一批落地）；半切换必被 `VERSION_CONFLICT` 拒且不建 run 目录（一次真重放证实）。
  - 密封脚本环境**重建 + 重新出证**；软件矩阵从"六格全 EXPECTED 零绿"变 `PASS 3 / EXPECTED 3 / FAIL 0`，**nmap 因配方声明了 7.95 不存在的参数被拒绝冻结**，没有一处是靠声明刷绿的。
  - 能力地板 `pass 26 / declaredAbsent 1 / unverified 0`；剩的 `profile:administrator` 有意保留，不为凑零而声明。
  - 45 格矩阵 `PASS 41 / NEEDS-INPUT 1 / EXPECTED 3 / FAIL 0`；新登记 D-53…D-64 十二条。
  - **共享 `current` 仍一字未翻**。

## 2026-09-21 ｜ 3.1.0 提案（未定稿）

- 目标形状"一专业领域 = 一个专家 + 一条通用 workflow + N 个场景 skill"，含框架增量 F-1…F-5 与 P 表 T-P1…T-P9。
- <span class="pill pill--danger">提案 · 未定稿</span> 按 BP-5.1，**该文的 P 表未经用户批准不构成实施授权**，且不得向 3.0 的任何 S-P 判据追加要求（→ [3.1.0 更新方案](/docs/history/3.1.0-proposal)）。

## 2026-09-22 ｜ 读盘件

- [架构 3.0.0 文件地图](/docs/architecture/3.0.0-file-map) 按当日读盘写成：五处共享 `current.json`、六份配方 `current.json`、六平台 config 与 `capabilities.json` 逐项实读。它不新增能力申报、不改判据。
- 同日本站上线：`E:\ai\docs-site`，白名单 30 条，一条 `docs-conform` 复算。

## 怎么读这条时间线

同一天经常出现两个"版本事实"：一个在**发布字节**上，一个在**共享指针**上。它们由两套不同机制管理，**发布时间与切换时间不是一回事**，各平台生产钉的版又自成第三套。三者都在自动生成的目录页上分列显示，别从时间线里推断当前值。
