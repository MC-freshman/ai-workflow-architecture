# ZCode 平台章：2026-09-17 卸载后重新接入

> **〔2026-09-22 治理口径更正（由 qoder 会话依用户「连平台章一起校订」的一次性授权代为登记；本章任何机检读数一字未改）〕** 三条复述型条款在本章的旧措辞请按此读法：① 凡「数模求解链（`math-solver-chain`）不承接」「交稿级须先确认目标平台已声明并验证」「不要默认转 zcode 交稿」一类句子，保留为**当时的实测快照**，不再是调用规则——用户 09-22 裁决**数模与其它 agentic workflow 等同**，`math-solver-chain` 不再是各平台需声明的能力项，环境需求按 BP-1 §1.6 三选一归属（见 `versions/架构基本原则.md` §9 第 11 条、`invocation-adapters-spec.md` §3.1）。② 凡「跨平台资源仲裁未满足 / 需用户单独授权」，该项自同日起**已从必需项中撤销**：续跑只需「版本一致性校验 + 带 sha256 的可回读交接载体」两项，平台内锁表即正确形态；代价明写在条文里（同一项目被两客户端同时开工不会被发现、会互相覆盖）。③ 判据 harness 的现行合法路径是 `tool/architecture-ops/versions/1.2.0/architecture_ops/invocation_matrix.py`（或本平台自己 `bridge/ops/` 那份）——旧 `zcode\workspaces\agentic-workflow-implementation\` 工作区 2026-09-17 已删除，任何指向它的命令行都跑不通。本节不改动本章任何 baseline 数字；如与本节冲突，**以本平台 baseline 件为准并回改本节**。

## 当前结论

按架构 1.0.0 接入判据重新接入完成。新矩阵 `runtime/matrix-smoke/reconnect-final.json`：**PASS 38 / NEEDS-INPUT 0 / EXPECTED 2 / FAIL 0**，退出码 0。该矩阵只测试 prepare → next/claim → stop，不是全部业务工作流终态成功。

旧 bridge/runtime/workspaces 被卸载后缺失；此次为重建，不是找回原文件。旧验收证据不能当作本次能力凭证。

## 配置与入口

- bridge：`E:/ai/zcode/bridge.json`
- runner 配置：`E:/ai/zcode/bridge/zcode-config.json`
- Python：`E:/ai/zcode/runtime/py-env/Scripts/python.exe`，3.9.13
- runner：**wf-runner 0.7.7 栈（2026-09-19 生产接入）**：`contracts=runtime-contracts/1.1.0` + `scannerRelease=repo-lint/0.3.0` + `executionBackend`（WSL2+Landlock，D04 只读绑定）+ `peerDispatcherModule/peerContentRoot`；`bridge.json` 平台作用域默认 `repo-lint=0.3.0`。共享 current 已于 09-19 切换（`0.7.8` / `0.3.0` / `1.1.0`，清单 §8.9/§8.10）；本平台生产仍显式钉 0.7.7 栈，观察窗口继续度量同一字节集。
- `/wf`、`/wfa` 用户级及工作区级命令已修正；`/math` 用户级命令已修正。
- 用户级和工作区级 workflow-hub 已同步；插件缓存未编辑。用户级副本优先。客户端可能需新会话重新发现入口，当前未通过 GUI 验收斜杠菜单刷新。
- 默认 inputRoots 仅本平台。外部输入需经授权复制进平台，不能默认扩展读取面。

## 本次实证

1. runner --help 通过；8 个 runner 锁定依赖版本逐项匹配，离线复制到独立环境并逐文件比对哈希。
2. game-sprint-plan 2.1.1，run `zcode-reconnect-smoke-20260917-r2`：prepare、next、intake submit、stop 均成功，终态 stopped，非完整 succeeded。测试明确标识合成任务；未虚构用户产能，缺信息在 intake 中保留。
3. renderer：matplotlib 3.9.4 Agg 实际出图并经 Pillow 解码验证，环境快照匹配测试通过。这不是视觉质量验收。
4. renderer 专家专项复测 1 PASS；数模工作流/专家入口专项复测 2 PASS。
5. 完整矩阵第二轮 38 PASS、2 EXPECTED、0 FAIL。第一轮 35 PASS、5 FAIL 保留；其中三个 renderer 快照问题已修复，其余两条为既有架构例外，按实测错误码登记，未放宽矩阵判定。

## 能力边界

已恢复 CLI、版本解析/锁定、prompt 领取与证据提交、终态停止、基本本地 renderer。

未恢复或未验收：scriptEnvironment 隔离环境、协议 script 阶段、process 门禁、peer 派发、MCP 工具面、数模求解器/严图/九阶段/冻结、崩溃恢复。不能沿用旧平台的完整能力声明。prompt 权限由会话执行约束，不声称操作系统强制隔离。

**（2026-09-18 日期事实补充，仅 pilot 面）**scriptEnvironment（0.7.5/0.7.6 WSL+Landlock 链，项3）与 peer 派发（A3 `bridge/ops/peer_dispatcher.py`，V6-a..e 全绿，`baseline/V6-*.json`）已在 `zcode-config-pilot.json`/`capabilities-pilot.json` 面验收通过；本段"未恢复或未验收"对**生产面**（`zcode-config.json`/`capabilities.json`，仍钉 0.6.0）继续成立，接入属收口波。

**（2026-09-18 晚共享账补充，不改上行）**现行架构基线已为 `versions/架构2.0.0.md`（2026-09-18 带偏差定稿）；共享侧 `wf-runner 0.7.7` 已发布、qoder 生产已切 0.7.7 栈。本平台生产仍钉 `0.6.0 + repo-lint 0.2.1`（pilot 0.7.6）；pilot→生产接入复验、两平台四门终检合表与本平台观察窗口仍属未完成（账源：`versions/平台接入清单.md` §8.5–§8.6）。

**（2026-09-19 生产接入，取代上段的本平台版本事实）**用户授权后执行 pilot→生产接入：生产三件切 **0.7.7 栈**（apply 前后逐字节哈希留档 `runtime/maintenance/2.0-prod-adoption/logs/apply-hashes.txt`；切换前备份 `pre-adoption/`，bridge.json `74f6d485…` 与账一致）。**受影响面电池 B1–B6 全绿**（生产 config + 0.7.7 字节）：conformance 9/9；入口解析演练（含 null-defaults CLI 等价检查）；真实脚本链 negatives + snapshot 到 `succeeded`（jail 内 Landlock ABI 3、`environment_guard` 0.7.7 字节、控制器哈希 `2cd9c123…` 验证）；peer 五面 battery GREEN（真实子 run、血缘、幂等、四拒绝面、wire delegate 0.7.7 语义 `STALE_ATTEMPT`）；`repo-lint@0.2.1` 显式请求落盘前 `VERSION_CONFLICT`（缺陷③ 闭合形态，该格可调用性未变）；写回互斥 7/7。证据：`runtime/maintenance/2.0-prod-adoption/baseline/`（BATTERY-SUMMARY 为索引）。capabilities 已盖章 `attestedAt=2026-09-19`。**观察窗口起算 2026-09-19 10:31(+08) → 09-21 10:31(+08)**（`WINDOW-START.md`，判据按 2.0.0 §10.3 回读真实 run）。**仍未实测（生产面）**：`process` 门禁、崩溃恢复、MCP 工具面、数模求解链（`declaredAbsent` 维持）。

例外：wf-runner 自调用（设计如此）；repo-lint 所需权限策略无已验证适配器。见 `invocation-exceptions.json`。

## 数据与卸载风险

本次没有恢复历史项目、历史 run-lock 和产物。没有迁移正在运行的 ZCode 应用，也没有修改安装器或卸载器。应用文件与平台数据目前仍共用 `E:/ai/zcode`，再次卸载前必须另行备份 bridge.json、bridge、runtime、未来 workspaces；本次不能保证再次卸载会保留这些目录。**（2026-09-19 更新）**`bridge.json` + `bridge/` 已纳入根级白名单仓跟踪（提交 `e0123229`，清单 §8.11）——再次灭失可用 `git checkout e0123229 -- zcode/bridge zcode/bridge.json` 恢复；`runtime/`（证据与环境）仍不在仓内，再次卸载前仍须另行备份。**（2026-09-19 10:13 更新实测）**当日客户端更新为**原地替换二进制**，`bridge/` 与 `runtime/` 未受损：git 跟踪面 64 件中 63 件与 HEAD 逐字节一致（唯一差异为本章当日编辑），doctor 全绿（runner 0.7.7 / contracts 1.1.0 / 四 checks true / declaredAbsent 仅 mcp 与求解链），生产入口 prepare→stop 冒烟通过。

维护证据：`E:/ai/zcode/runtime/maintenance/20260917-reconnect/`。维护记录 agent/workflow=null，与真实冒烟 runs 分开。

## 2026-09-26 完全接入新架构（3.2.0 配对代 + software 面）

> 授权：用户 2026-09-26「架构已经更新，请将 zcode 完全接入新架构」。判据与台账：`runtime/maintenance/20260926-3.2-adopt/`（Z-P-TABLE.md + Z-LEDGER.md）。本节取代上文所有版本事实段（那些段落按其日期作为历史快照保留）。

**引擎成套切代（Z-P2）**：生产配置从 0.10.0/1.4.0/0.5.1（2026-09-23 整理轮的文本对齐，未经本平台自证）成套切到 **wf-runner 0.10.1 + runtime-contracts 1.4.1 + repo-lint 0.5.2**（3.2.0 裁定记录 §1 的配对代；checkpoint 逐字节在 `20260926-3.2-adopt/pre-adoption/`）。新增显式 `scriptEnvironmentRungs`（kernel-sandbox → 既有 WSL2+Landlock backend，`requiresSealedEnvironment=true`）——conform 1.4.1 要求声明 script 的平台必须有显式 rung，旧单键形态判 unverified。`bridge.json` 平台默认 repo-lint 同批抬 0.5.2。

**sealed 环境补装科学栈（Z-P4）**：WSL2 py310 密封环境按 **math-modeling-programmer@1.7.2 requirements-phase1.lock.txt 的精确锁版**补装 11 包（PyMuPDF 1.26.4 / matplotlib 3.9.4 / numpy 1.26.4 / pillow 11.3.0 / six 1.17.0 + 传递依赖），`script-environment.json` 重生成（205 → 2370 件，`__pycache__` 不入清单）；一次 `--target` 副作用把 packaging 顶到 26.3，已修复回锁钉 25.0 后才哈希。引擎自带 `environment_verify` full 校验 **2370/2370、0 mismatch**。jail backend 三根只读绑（tool+agent+**software**）。

**software 面接线（Z-P3，3.2.0 P7 本格）**：`softwareGateway` 钉共享连接器 `_connector/1.0.6`；六件软件本体由本平台逐文件实测哈希对比配方 verify.files（`Z3/body-survey.json`）——dirsearch 2/2、mysql-cli 3/3、wireshark-cli 5/5、burp-suite 4/4、veracrypt 2/2 全对上；**nmap.exe 一位十六进制漂移**（与 D-61 的"配方事实与真本体不符"互证），如实登记不刷绿。连接器冒烟 10/10 结构化；真实派发 dirsearch `version` 能力到 exitCode 0（stdout `dirsearch v0.4.3`），同键重放 `replayed=true` 不重派，证据落 `runtime/software/evidence/`。`credentialProvider`/session provider 未声明——凭据调用如实答 `CAPABILITY_UNAVAILABLE`，补齐路径在台账。

**能力重盖与出证（Z-P4）**：`capabilities.json` 重盖 attestedAt=2026-09-26（descriptor v2：prompt/script/peer 三 facet + `python>=3.8` profile；CON-04 四件 evidenceBindings 绑本轮字节）；`math-solver-chain` 按 09-22 裁决移出 declaredAbsent（该项已不存在于 union）；`mcp-tool-surface` 维持 declaredAbsent 带 240 分钟补齐路径。全矩阵（architecture-ops 1.4.0，harness digest `de1a7b62…`）：**PASS 48 / EXPECTED 3 / FAIL 1**——FAIL 唯一格是 repo-lint@0.5.2（见下 Z-D2，共享侧缺陷，不作为本平台缺口登记）；EXPECTED 三格是 nmap/burp-suite/veracrypt 快照未冻结（台账 `invocation-exceptions.json` 按观察码 `SNAPSHOT_NOT_FROZEN` 登记、各带补齐路径）。conform 终值：**items 27 / pass 26 / declaredAbsent 1 / unverified 0 / remediationMissing 0**（digest `5e7f769c85cf`；声明 softwareRoot 后软件仓首次进 union，`unionSha256=21afc04781c3` 与 qoder config 独立复算**逐字相同**——BP-2 并集一致性的本平台机检；唯一 absent 是 `profile:administrator`，由 veracrypt@1.0.0 的 requiredProfiles 引入，按 3.0-Q 先例有意保留、带 90 分钟逐次授权闭合路径）。

**本轮登记的缺陷（只登记，不当场修；详单见台账）**：
- **Z-D1（共享侧）**：platform-conformance 1.4.1 的 ENTRY-04 不认识 3.3.0 新域引入的 `kind: pipeline`（framework-pipeline/paper-pipeline `invocable=true`）→ 套件对任何平台必 1 fail；改前改后逐字相同，与本轮配置无关。
- **Z-D2（共享侧，阻断级）**：repo-lint 0.5.2 释放件内 workflow.yaml 自述 0.5.1 → 引擎严格闭包以 `definition-mismatch` 在 prepare 拒绝 ⇒ **共享 current 的扫描器释放件经引擎路径当前不可调用**（R2 漂移类复发，正是 3.1-A F-3 要防的同类）；矩阵该格 FAIL 如实保留。
- **Z-D3（共享侧，观测级）**：runner↔contracts 混代不被机械拒绝（scratch 配置 runner 0.10.1 + contracts 1.4.0 对 game-sprint-plan@2.1.1 prepare 成功），且 run-lock resources 不记录 contracts 释放版 → 混代在锁内零痕迹；"混用即 VERSION_CONFLICT" 目前只在 repo-lint↔scannerRelease 一对上机械成立（D-52）。

**维护期移交**：48h 观察窗口自 2026-09-26 本轮收口起算；`credentialProvider`（Windows 凭据管理器 + reference:mysql-local 语义，约 45 分钟）与 MCP 工具面（约 240 分钟）待后续轮；Z-D1/Z-D2/Z-D3 归共享侧统一修复方案。
