# 模块拆卸 / 替换 / 重组规程（P4，2026-11-11 模块化更新轮）

> 适用对象：`src/app/module-registry.json` 中 `kind=panel` 的模块（试点：`panel-runs`）。
> 上位约束：注册表是**派生视图**，禁手改；一切开关经声明源 `src/app/module-overrides.json`；
> 替换实现须先过契约测试；远程代码一律不加载（CSP 本地只读）；写通道语义零扩大。

## 0. 机制总览

| 件 | 位置 | 职责 |
|---|---|---|
| 视图声明源 | `src/app/view-definitions.json` | 视图/分组/描述/面板组合/分节 |
| 开关声明源 | `src/app/module-overrides.json` | `overrides.<moduleId>.enabled / .replacement` |
| 派生注册表 | `src/app/module-registry.json` | 生成物；`node scripts/generate-module-registry.mjs` 重生成，`--check` 机检 |
| 装载器 | `src/renderer/features/workspace/panel-loaders.mjs` | `panelLoaders`（原实现，与面板模块 1:1）+ `replacementLoaders`（替代实现） |
| 渲染器 | `src/renderer/features/workspace/ViewRenderer.jsx` | 按注册表组合；`enabled=false` → 统一空态；`replacement` → 替代装载器 |
| 判据 | `test/module-registry.test.mjs`、`test/module-replacement-pilot.test.mjs` | 新鲜度/通道/视图/装载器 1:1/overrides 合法性/契约逐字一致/默认关闭 |

## 1. 拆卸（detach）

1. 编辑 `module-overrides.json`：`{"overrides": {"panel-runs": {"enabled": false}}}`。
2. `node scripts/generate-module-registry.mjs && npm run build:ui`。
3. 启动应用：runs 视图显示统一空态「模块已拆卸」；**通道面不动**（`runs:ledger` 仍在 operations.json，query 面零变化）。
4. 还原：overrides 移除该键 → 重生成 → 重建。

## 2. 替换（replace）

1. **写替代实现**：独立代码，不 import 被替换域（机检断言）；渲染层安全的核心放 `pilot/*-core.mjs`（禁 node 内置），fs 读取放 `pilot/*.mjs`（仅 Node 侧/测试用）。
2. **注册装载器**：`replacementLoaders['panel-<x>-alt'] = { load: () => import('./pilot/<x>-alt-panel.jsx'), pick: ['<Comp>'] }`。
3. **契约测试**：新增 `test/module-replacement-<x>.test.mjs`，共享 fixture 上替代实现与原域输出**逐字一致**（deepEqual）；未过测试不得启用。
4. **启用**：overrides `{"panel-runs": {"replacement": "panel-runs-alt"}}` → 重生成 → 重建 → 真机截图核对行为一致。
5. **回退**：overrides 移除 replacement → 重生成 → 重建（原实现立即恢复）。

## 3. 重组（recombine）

- 视图组合（哪些面板、顺序、分节）改 `view-definitions.json` → 重生成 → 重建；`test/module-registry.test.mjs` 钉住视图↔面板↔装载器三方一致。
- 面板跨视图移动只改声明源，不改渲染代码。

## 4. 软件接入选项（纸面示例，本轮不实际接入）

同一规程适用于第三方软件经适配器接入：适配器实现同契约 → 注册装载器/域适配 → 契约测试 → overrides 启用。
矩阵见 `versions/架构与管理台模块化更新P表-20261111.md` §4：如 M09 git 域 → isomorphic-git（局限：Windows 凭据管理器/GPG/性能）、M20 MCP 协议层 → @modelcontextprotocol/sdk（代价：配方安装需 npm 依赖）。**任何实际接入另立 P 表与授权。**

## 5. 试点读数（2026-11-11 真机）

- 拆卸：`screenshots/p4-detached.png`（空态「模块已拆卸」，0 行）。
- 替换：`screenshots/p4-replaced.png`（替代面板，357 行，与原台账同数据）。
- 还原：`screenshots/p4-restored.png`（原「运行台账（只读）」面板，357 run）。
- 契约：`test/module-replacement-pilot.test.mjs` 5 例（独立性/summarize 8 形态/inspect 4 态/ledger 逐字/默认关闭）。
- 演示后 overrides 与注册表已还原默认（overrides={}，全模块 enabled、replacement=null）。

## 6. 第二试点读数（N3，2026-11-13 真机）

- 对象：`panel-audit`（审计读面），替代实现 `pilot/audit-alt-core.mjs`（renderer 安全纯函数）+ `pilot/audit-alt.mjs`（Node 侧）+ `pilot/audit-alt-panel.jsx`。
- 拆卸：`20261113-u-round/n3-detached.png`（空态）；替换：`n3-replaced.png`（替代面板 100 行）；还原：`n3-restored.png`（原面板 100 行，同数据）。
- 契约：`test/module-replacement-audit.test.mjs` 5 例。**逐字可比子集口径明写**：action/status/occurredAt/planId/operationId/transactionId/phase/workspaceRoot + 计数（total/corrupt/invalid/matched/checkpoint）+ integrity 的 hashed/legacyUnsealed/missingTimestamps + operationsWithoutTerminal；**哈希验证（verified/mismatch）与 checkpoint 文件核对保留域侧**（renderer 安全核心不做 fs/crypto），不假称全语义等价。
- 结论：替换机制跨模块通用性成立（runs 数据面 + audit 事件面两试点）。