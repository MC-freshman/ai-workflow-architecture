# 审计 P2 报告：测试覆盖终版地图（architecture-manager v0.8.1）

- 审计人：QA 严过关（software-qa-engineer）
- 日期：2026-10-10（本机时间）
- 数据来源：全量 `node --test --test-reporter=tap --test-concurrency=1`（原始 TAP：`test-run-tap.txt`）；`node --test --experimental-test-coverage`（原始输出：`coverage-run.txt`）；import 图（`ref-graph.json`）
- **环境关键前提**：本沙箱对 `spawnSync`（任意可执行文件：python/git/node/powershell/electron）存在 EBUSY 阻断（异步 spawn 正常）。实测影响详见 §2。

## 1. 全量测试读数（TAP，concurrency=1，串行）

| 指标 | 数值 |
|---|---|
| 顶层用例 | 276（65 个测试文件） |
| pass | 221 |
| fail | 53 |
| skipped | 2（均为平台门控：`ok 187` Linux/WSL 后端、`ok 254` Python worker——Windows 环境预期跳过，非缺陷） |
| 总耗时 | 1330s（串行，含 EBUSY 重试开销） |

## 2. 53 个失败的归因（逐条已核）

**结论：53/53 全部为本沙箱环境性失败，无一确认为源码缺陷。** 根因：沙箱对 `child_process.spawnSync` 返回 EBUSY（实测：`spawnSync git` 10/10 EBUSY、`spawnSync node.exe` 稳定复现、`spawnSync python EBUSY` ×37 条失败；异步 `spawn` 一切正常）。

| 归因类别 | 数量 | 说明 |
|---|---|---|
| 直接 EBUSY | 41 | `spawnSync python EBUSY` ×37、`powershell` ×1、`git` ×1、electron 二进制 spawn ×1、async spawn 可达但同步通道被阻 |
| spawnSync 失败被防御性 catch 转为业务否定值 | 4 | `test 55`：`legacy.mjs:21 sharedBlobs` 的 `catch {return null}` 把 git EBUSY 吞成 `sharedMetadataReconstructed:false`（断言 false!==true）；`test 140`：`inventory.test.mjs:333` 的 `spawnSync python` status=null≠0；`GIT_CLONE_FAILED` ×2（workspace-bootstrap 内 spawnSync git 失败被泛化） |
| 级联（前步 EBUSY 致状态缺失） | 8 | 如 `test 212` `"undefined" is not valid JSON`（前步锁文件/校验未产出） |

环境归因置信度：**高**（42 条直接证据 + git spawnSync 10/10 复现 + 全部失败模式均含 spawnSync 调用栈）。遗留动作：需在无 EBUSY 的环境（总监侧或裸机）复跑一次全量测试，确认 221+53 全绿基线——本轮沙箱内无法完成，已列入 §5 遗留。

**附带审计观察（P3 线索，非缺陷）**：`legacy.mjs:11-21` 与 `workspace-bootstrap.mjs:60-65` 把**所有** spawn 异常（含环境性 EBUSY）无差别折叠为业务语义（"证据未重建"/"克隆失败"）。方向上是安全侧（宁可重认证/不克隆），但会掩盖环境故障并让审计事件丢失根因；建议后续区分"业务不匹配"与"进程启动失败"两类错误码。走查阶段（P3–P7）复核。

## 3. 测试↔模块映射（终版，import 关系实测）

### 3.1 有直接测试的主进程域（63 文件 import 关系）

| 域 | 测试文件（节选） | 状态 |
|---|---|---|
| 事务内核/恢复 | audit-regression、recovery-ownership、audit、defects-transaction | ✓（本轮全绿） |
| Git | git-executor、git-safety-regression、archive-tool | ✓ |
| intake | intake-publication、intake-source、automatic-intake、automatic-software-intake、platform-body、software-body、tool-body、agent-skill-body、runtime-body、native-mcp、intake-electron-asar | 部分 EBUSY fail（python 探针类） |
| software | software-launch、software-health-regression、global-update、gateway-repair | 部分 EBUSY fail |
| platforms | native-onboarding、bridge-compatibility、platform-resource-defaults、onboarding-chain、onboarding-resume-deferred、native-ai-probe、native-mcp | 部分 EBUSY fail |
| certification | anchor×5、certification-×4、declared×2、matrix-progress | ✓（test 55 为 EBUSY 间接） |
| onboarding 核心 | onboarding×4、onboarding-client、onboarding-config、onboarding-process、onboarding-recovery、onboarding-evidence-regression | ✓ |
| 基础设施 | task-lifecycle、task-worker-regression、task-domain-regression、workspace-bootstrap、workspace-audit | 部分 EBUSY fail（worker/clone 类） |
| app 装配 | module-boundaries、ui-operation-regression、frozen-preload、declared-snapshot、conform-proof | ✓ |

### 3.2 零直接测试缺口（终版，维持 P1 方案判定并经实测确认）

| 缺口 | 内容 | 优先级 |
|---|---|---|
| `src/main.mjs` | 117 个 IPC handler 注册、BrowserWindow/会话/生命周期配置 | 高 |
| `src/core/paths.mjs` | safeRelative/targetPath 路径安全核心（含软链/junction 逃逸防御），无专属单测 | **最高** |
| `src/core/physical-fs.mjs`、`core/onboarding-jobs.mjs`、`infrastructure/filesystem.mjs` | 底层 FS 与作业管理 | 中 |
| `src/onboarding-finalize.mjs`、`onboarding-governance.mjs`、`onboarding-runtime.mjs` | 接入收尾三域，0 直接 import（仅经 app/api 间接） | 中 |
| `src/runtime/`（20 Python + task_worker.mjs + windows_job.ps1） | 认证矩阵/凭据/恢复真实进程侧；本轮 53 个 EBUSY 失败几乎全部位于需要真实子进程的测试——**即使环境正常，这些 Python 模块也只被黑盒经过** | 高 |
| `src/renderer/`（39 jsx + 22 mjs） | 仅 6 文件有测试（presenter、task-client、request-coordinator、schema-fields、onboarding-draft、documents/commands）；**22 个 panels + App.jsx 零测试** | 高（沙箱隔离限制爆炸半径） |

### 3.3 覆盖率读数（node 内置 coverage，采集运行：222 pass / 52 fail / 2 skip——比 TAP 轮少 1 个失败，再次证实 EBUSY 的间歇性）

项目 `src/` 共 **132 个文件**被插桩（另有 55 个 renderer 文件因无任何测试 import 而完全未插桩）：

| 指标 | 数值 |
|---|---|
| 行覆盖 100% 的文件 | 67 / 132 |
| 行覆盖 <80% | 33 / 132 |
| 行覆盖 <50% | **18 / 132** |
| 简单平均（行/分支/函数） | 85.1% / 76.1% / 77.5% |
| 全局行（含沙箱注入 shim 噪声，仅参考） | 78.92% / 75.00% / 78.90% |

**行覆盖缺口 Top 10（注意：多数是 EBUSY 失败用例压低的"真实进程"路径，与 §2 归因对照读取）**：

| 文件 | 行% | 函数% | 备注 |
|---|---|---|---|
| domains/platforms/global-update.mjs | 11.5 | 0 | 一键更新主体，本轮全部 EBUSY |
| domains/platforms/management-runtime.mjs | 24.3 | 0 | 原生管理运行时 |
| domains/intake/software-body.mjs | 25.3 | 16.7 | 软件正文安置 |
| domains/platforms/runtime-discovery.mjs | 26.8 | 0 | 解释器探测 |
| onboarding-runtime.mjs | 28.3 | 20 | 接入运行时（零直接测试域之一，实测坐实） |
| domains/intake/platform-body.mjs | 29.0 | 0 | 平台正文安置 |
| domains/intake/smoke.mjs | 29.8 | 0 | 正文冒烟 |
| onboarding-attestation.mjs | 31.0 | 0 | 认证背书 |
| domains/software/mcp-config.mjs | 34.0 | 0 | MCP 配置读写 |
| domains/platforms/resource-environment.mjs | 35.0 | 40 | 资源环境绑定 |

另两处值得注意：`core/paths.mjs` 行覆盖 100%（经事务测试间接到达）但**分支覆盖仅 74.07%**（软链/junction 边缘分支未测，证实 §3.2 专项单测的必要性）；`core/owned-process.mjs` 行 42.1%、函数 0%（进程所有权核心，仅任务生命周期测试擦过）。完整逐文件数据：`coverage-src-rows.json`。

## 4. 定向补充用例建议（D2 清单，供确认后实施）

1. `core/paths.mjs` 专属单测：junction 祖先、大小写、8.3 短名、UNC、`..` 变体（`....//`）、尾部点/空格。
2. `git-executor`：以 `-` 开头的 branch/tag/remote 名（git 选项注入面）；`buildGitPlan` 侧校验核查。
3. `transactions` integration 多文件事务：mirror 第 N 个写失败后主文件+companion 的回滚完整性（现有 recovery-ownership 未覆盖 mirrors）。
4. `software-launch`：连接器非 JSON 输出/超时/超 maxBuffer/`--config` 临时文件残留（崩溃窗口）。
5. `onboarding-recovery`：`own()` 对指向工作区外的 junction；`mergeFirstMatrix` 的 mkdirSync 竞态。
6. `main.mjs` 116 个 IPC 入口的 input 为 null/undefined 抽样（至少覆盖直接解构 `input.workspaceRoot` 的 handler）。
7. `presenter.mjs` 错误码→文案映射表防重复键回归（本报告 D-001/D-002 的守护用例）。

## 5. 遗留与移交（2026-10-10 更新：权威 digest 已回填）

**终版 D1 结论（真实环境权威读数，总监侧 Node v24.18.0 实跑 conform，440s）**：
- lint ✅ exit 0、preload ✅ exit 0、tests **276 例 = 273 pass / 1 fail / 2 skip（99.0%）**
- 唯一失败 test #110 `intake-electron-asar.test.mjs:9`：`spawn ...\electron\dist\electron.exe ENOENT`——根因为依赖安装时 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 跳过 Electron 二进制（环境操作所致，已认领补装），**非项目缺陷、非 UI 改动引入**。digest `c1f2bbc3...`（ok:false 因该单失败）。
- **ok:true 终版 digest 已回填**（2026-10-10T02:20:10Z，Electron 二进制补装后复跑，Node v24.18.0，evidenceVersion 2）：lint ✅ exit 0、preload ✅ exit 0、tests **276 例 = 274 pass / 0 fail / 2 skip**，digest `6cc9e253cb9230b3f743949af0415e80cc43d4cfe256bbd1e0bf64928195c9c0`，`sourceStable: true`。证据落盘 `conform-evidence/conform.json`（tests.stdout 同步更新）。
- **坐实本报告 §2 的归因**：沙箱内 53 个 EBUSY 失败在真实环境**全部通过**，销项为「agent 宿主 spawnSync EBUSY 环境受阻」，证据链保留于 `test-run-tap.txt`；本报告覆盖率读数的"EBUGY 压低"注记同样成立。
- 2 skip 仍为平台门控（WSL/Python worker），预期行为。

原遗留项状态：

| # | 事项 | 状态 |
|---|---|---|
| 1 | 无 EBUSY 环境复跑全量测试确认基线 | ✅ 已完成（真实环境 273/276，唯一失败为 electron 二进制未装） |
| 2 | 官方 conform digest | ✅ 已完成（补装 Electron 后复跑 ok:true，274/276+2skip，digest `6cc9e253...`，证据在 conform-evidence/） |
| 3 | P3–P7 人工走查 | ✅ 已完成（R0–R6 六层走查，见 audit-final-p3-p7.md） |

D-001（presenter.mjs 重复键文案覆盖，P2）、D-002（重复键卫生，P3）保留在册，转入修复批次处理。
