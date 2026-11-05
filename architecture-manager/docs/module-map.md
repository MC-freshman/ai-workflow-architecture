# 管理台模块职责

`src/main.mjs` 只启动应用；`electron/application.mjs` 负责生命周期、任务收口与重新开窗。`electron/register-operations.mjs` 注册声明过的操作，`electron/ipc-router.mjs` 将领域调用交给所属工作区任务；`app/operations.json` 仍是 IPC 与预加载 API 的共同声明源（`src/preload.cjs` 由 `scripts/generate-preload.mjs` 从它生成，通道逐条一致）。

`electron/window.mjs` 创建隔离、沙箱化的本地窗口；`electron/security-policy.mjs` 集中 CSP、导航、弹窗和权限策略，构建时由 Vite 注入同源策略。`electron/workspace-preferences.mjs` 保存用户最近使用的工作区。`renderer/` 是 React 渲染层（`App.jsx`、`panels/`、`features/`、`presenter.mjs`），只经预加载 API 调用，不直接触盘。

`src/` 顶层只保留三个入口：`main.mjs`（Electron 主进程）、`cli.mjs`（`npm run scan`；另有 `relayout` 写入子命令，备份 → 重铺 → 复验，带 `--dry-run` 与失败回滚）、`preload.cjs`（生成产物）。领域代码全部归入 `domains/`，跨域机制在 `core/`、`infrastructure/`、`transactions/`。

## 域（`src/domains/`）

- **onboarding/**（15）：平台入驻流水线。`onboarding.mjs` 主编排；`onboarding-config`（配置与版本）、`onboarding-runtime`（运行环境，`verifyTimeoutSeconds` 预算在此解析）、`onboarding-client`（客户端入口）、`onboarding-providers`（provider 面）、`onboarding-l1`（L1 双格判据）、`onboarding-entry-skills`（wf/wfa 入口技能与插件包导出）、`onboarding-governance`（治理文本集合与重命名源）、`onboarding-finalize`（收口提交）、`onboarding-state`（入驻记录）、`onboarding-recovery`（续跑）、`onboarding-auto`（自动接入）、`onboarding-attestation`（能力探针出证）、`onboarding-seed`（安装包种子铺放）。
- **platforms/**（24）：平台盘点与接入检查。`platform-check`（平台检查）、`integration`（客户端集成目标）、`version-combo`（显式版本组合探针）、`global-update`（一键更新）、`native-client` / `native-*`（原生回执）、`onboarding-readback`、`runtime-discovery` 等。
- **intake/**（20）：资源导入与发布。`releases`（发布计划）、`inbox`（收件区只读盘点）、`publication`、`automatic-software`、`shared-body`、`tool-body`、`software-body` 等。
- **software/**（12）：软件接入。`software`（软件仓读面）、`software-intake` / `software-launch` / `software-publish` / `software-recovery`、`gateway-migration`、`health` 等。
- **resources/**（7）：三仓资源注册表与契约。`registry`、`contracts`（+ `contracts/` schema）、`catalog`、`inventory`。
- **certification/**（14）：完整认证的锚定与对齐（`anchor*`、证据、进度）。
- **git/**（5）：Git 计划与事务执行。`git`（`buildGitPlan`）、`git-executor`、`state`（暂存校验）、`sensitive`（敏感扫描）。
- **audit/**（3）：审计事件与缺陷簿只读面（`audit`、`defects`）。
- **plans/**（2）：计划中心（`plans`、`plans-center`）。
- **docs/**（2）：文档操作（`docs-ops` 调文档站脚本、`documents` 治理文档读写）。
- **runs/**（1）：run 台账只读盘点（`runs`，只解析 run-lock，不写）。
- **workspace/**（1）：工作区引导（`workspace-bootstrap`，克隆与首扫）。

## 跨域机制

- `core/`：无 Electron 依赖的纯机制（哈希、JSON/JSONC、路径、平台清单、版本、子进程环境、任务生命周期、矩阵进度、探针锁等）。
- `infrastructure/`：文件系统、Git、进程作用域、任务执行器等宿主交互。
- `transactions/`：已批准计划的路由与原子执行。`router.mjs` 按 kind 分发 apply/verify；`kernel`、`recovery-journal`（可继续、可核验、冲突拒绝）、`integration`（多文件写入与恢复协议）、`operation-audit`。
- `app/`：IPC 面。`operations.json` 声明源，`api`/`query-api`/`command-api` 保持读/写分离（查询面不得出现 apply）。
- `runtime/`：Python 宿主驱动脚本（探针、环境、派发）与**生成产物** `platform_defaults.mjs`（由 `scripts/build-management-bridge.mjs` bundle 生成，勿手改）。

边界规则（由 `test/module-boundaries.test.mjs` 钉住）：`core/` 与 `transactions/kernel` 不得依赖 Electron、不得引用 `renderer/`；`app/operations.json` 声明的每个通道必须同时被 `register-operations.mjs` 注册且出现在 `preload.cjs`；Electron handler 引用的绑定必须显式导入（打包成 asar 后延迟失败变启动失败）。
