# 审计 P1 报告：依赖与代码卫生（architecture-manager v0.8.1）

- 审计人：QA 严过关（software-qa-engineer）
- 日期：2026-10-10（本机时间）
- 范围：只读静态层（S1 eslint 强化 / S3 依赖审计 / S4 死代码 / S5 标记清点），未改动任何 src/、test/、配置文件
- 环境：Node v22.22.2（注意：package.json `engines.node >=24`，当前环境不符，见 D-003）；依赖由总监统一 `npm ci`（ELECTRON_SKIP_BINARY_DOWNLOAD=1），lockfile 实装版本见 §1.2

## 1. 依赖审计（S3）

### 1.1 npm audit 结果（`npm audit --json`，原始数据见 `npm-audit-raw.json`）

- 合计 **10 条**：critical 0 / high 2 / moderate 8 / low 0；全部位于 **devDependencies 工具链**（electron-builder 26.15.3 的传递依赖），**运行时依赖零告警**。
- 2 条 high：
  - `http-cache-semantics`（GHSA-ch52-4w7c-c8xp，缓存跨用户泄露，经 @electron/get ← app-builder-lib）
  - `source-map-js`（GHSA-68fv-2mgg-jv7q，事件循环 DoS，经 dmg-builder ← app-builder-lib）
- npm 给出的 fixAvailable：electron-builder **26.5.0**（受影响区间为 26.6.0–27.0.0-alpha.2，当前装的是 26.15.3；"修复"是降级钉版）。
- 评估：electron-builder 仅用于 `npm run package:win` 打包，不进入产品运行链路。打包机风险（下载源码/缓存），**建议后续将 electron-builder 钉到 26.5.0 或等待 27.0.0 正式版**；不构成产品缺陷。

### 1.2 四个运行时钉版人工核对（lockfile 实装版本）

| 依赖 | 实装版本 | 已知 CVE | 结论 |
|---|---|---|---|
| ajv | 8.20.0 | CVE-2025-69873（$data ReDoS，GHSA-2g4f-4pwh-qvx6），修复于 8.18.0 | **不受影响**（版本已高于修复线）；且本项目实际用 `Ajv2020({strict:false,allErrors:true,validateFormats:false})`（domains/resources/contracts.mjs:11 等 3 处），未启用 `$data` |
| yaml | 2.9.1 | CVE-2023-2251（<2.2.2）、CVE-2026-33532（深层嵌套栈溢出，<2.8.3） | **不受影响** |
| react / react-dom | 19.3.0 | CVE-2025-55182/55183/55184/67779/23864（RSC 反序列化 RCE 等，影响 react-server-dom-* 与服务端） | **不受影响**：本项目为纯客户端 Electron 渲染，无 RSC/无服务端；19.3.0 为最新支持线 |
| electron | 44.5.0 | 无针对性公开 CVE 命中当前版本线 | 允许脚本仅放行 `electron@44.5.0`（package.json allowScripts） |

### 1.3 环境注记

- Node 运行时 **v22.22.2** vs `engines.node: ">=24"`：见 D-003。

## 2. eslint 强化跑查（S1）

- 方法：`docs/audit-report/eslint-audit.config.mjs`（项目外临时配置，未改仓库 `eslint.config.mjs`）在仓库基线（仅 `no-undef`）之上叠加 correctness 规则集（no-import-assign/no-dupe-keys/no-fallthrough/no-unreachable 等 55 条 error 级 + no-unused-vars/no-empty/no-eval 等 warn 级），对 `src scripts` 全量执行。原始 JSON 见 `eslint-recommended.json`。
- 结果：**79 个文件有发现；error 5、warning 135**。
  - W 114 `no-unused-vars`
  - W 18 `no-template-curly-in-string`
  - E 3 `no-dupe-keys`（全部命中 renderer/presenter.mjs，见 §4 缺陷）
  - W 2 `no-useless-escape`（catalog.mjs:122、git.mjs:102，正则中多余转义，卫生问题）
  - E 1 `no-regex-spaces`（domains/git/backup.mjs:85，正则多空格计数问题，卫生问题）
  - E 1 `no-control-regex`（domains/intake/paths.mjs:15，`\x00-\x1f` 控制字符正则——**初判为有意的路径清洗**，属规则误报，转人工走查复核，不计缺陷）
  - W 1 `no-use-before-define`
- 有价值 no-unused-vars 样本（完整 114 条在原始 JSON）：`src/main.mjs:64 runOnboardingPipeline 导入未用`、`domains/intake/platform-body.mjs:12 verifyFiles 函数未用`、`inventory.mjs:34 PLATFORM_IDS 未用`、`integration.mjs:190 currentVersion 未用`——这些可能暗示**未接线的校验/逻辑**，列入 P3–P7 人工走查关注点。

## 3. 死代码与零引用导出（S4）

- 方法：`ref-graph.mjs` 构建 src/scripts/test 全量 import 图 + 导出名交叉引用，输出 `ref-graph.json`。
- **文件级死代码：0**。唯一零 import 的 `src/domains/platforms/default-command.mjs` 经核实是 `scripts/build-management-bridge.mjs:10` 的 esbuild 打包入口（产物为 `src/runtime/platform_defaults.mjs`），**非死文件**——若未来有人"清理"它会导致原生管理链路断供，已在报告标注防止误删。
- **零外部引用导出：19 个**（均在自身文件内部使用，属"多余 export"而非死逻辑，卫生级）：
  core/platforms.discoverPlatformIds、documents.TOP_LEVEL_REQUIREMENTS、certification/anchor.{ANCHOR_SCHEMA, anchorRefusal, anchorPairFacts}、certification/evidence.{ownEvidence, writeCoverage}、certification/fingerprints.certificationInventory、git/sensitive.inspectBytes、intake/software-body.normalizeSoftwareAction、intake/tool-body.workflowTextFiles、platforms/onboarding-resume.{ONBOARDING_STEPS, automaticJournalPath}、platforms/runtime-discovery.pythonCandidates、software/mcp-discovery.validateMcpSchemas、inventory.SHARED_REPOSITORIES、onboarding-providers.applyBindingEdits、plans.validatePointerTransition、runs.summarizeRunLock

## 4. 本步新确认缺陷（编号沿用审计总口径）

| ID | 级别 | 位置 | 证据 | 影响 | 修复建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-001 | P2 | `src/renderer/presenter.mjs:66-69` | 同一对象字面量内 `IMPORT_GIT_BASELINE_REQUIRED`（66 行与 68 行）与 `IMPORT_EXTERNAL_CHANGE`（67 与 69 行）**键重复且文本不同**，后者静默覆盖前者 | 66/67 行两段用户提示文案永远无法显示；Git 基线/外部变更错误提示可能展示错误口径的文案（行为与开发意图不符） | 去重并为两种场景分配独立键名（如 `IMPORT_GIT_BASELINE_REQUIRED` vs `IMPORT_*_CONFIG_BASELINE_*`），或确认保留哪段文案 | **确认**（eslint no-dupe-keys + 人工读码双证据） |
| D-002 | P3 | `src/renderer/presenter.mjs:194,205` | `RELEASE_SEMVER_INVALID` 键重复（两处文本相同） | 无行为影响，卫生问题 | 删除一处 | 确认 |
| D-003 | P3（环境） | 运行环境 | Node v22.22.2 vs `engines.node>=24` | 测试/lint 在非声明版本上运行，动态层结论的版本代表性打折 | 后续测试在 Node 24 复跑一次 | 确认 |

## 5. 标记清点（S5）

- `src/`：TODO/FIXME/HACK/XXX/@deprecated **0 命中**（方案阶段已测）。
- `docs/ scripts/ test/` 复扫：**0 命中**（排除本审计目录自身）。
- 结论：代码无遗留标记型债务，与"注释纪律良好"的静态印象一致。

## 6. 附：conform 基线与测试覆盖（S2/D1）

- 详见同目录 `coverage-map-v2.md`。
- **终版读数（2026-10-10 更新）**：真实环境（总监侧 Node v24.18.0）conform 全量 276 例 = 273 pass / 1 fail / 2 skip，唯一失败为 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 导致 electron.exe ENOENT（环境操作，非项目缺陷）；本沙箱 53 个 EBUSY 失败全部销项为宿主环境受阻（证据链在 `test-run-tap.txt`）。conform digest `c1f2bbc3...`，补装 Electron 后复跑取 ok:true 终版。
