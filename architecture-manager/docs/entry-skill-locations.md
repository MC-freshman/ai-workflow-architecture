# 各客户端 wf/wfa 入口技能位映射表（P2.1 产物，2026-10-14 实勘）

用途：P2 渲染与 P3 铺入口的唯一事实源。渲染取值一律从各平台**正式 config** 读取，不在模板中硬编码版本。

| 平台 | config（取值源） | invocation-manual | 本地技能位 | 形态 | 实勘现状 | P3 动作 |
|---|---|---|---|---|---|---|
| codex | `codex/bridge/runner-config.json` | 无（回落共享 spec） | `codex/bridge/skills/wfa/SKILL.md` | skill | 已有特化 wfa，**无 wf** | 现有不动；staging 对照补缺 |
| workbuddy | `workbuddy/bridge/workbuddy-config.json` | 有 | `.workbuddy/skills/<id>/SKILL.md` | skill | **P0 已验证加载生效**；工作区级 wf/wfa 已铺（2026-10-14），与用户级双轨并存 | 已铺；待新会话验证双轨呈现 |
| zcode | `zcode/bridge/zcode-config.json` | 有 | `.zcode/commands/<id>.md` | command | 已有特化 wf/wfa（含 0.6.0 锁版语义与数模 runbook） | 现有不动；staging 对照 |
| doubao | `doubao/bridge/doubao-config.json` | 有 | 无本地命令位 | — | 客户端命令机制待确认 | 仅 staging；登记待客户端接口（时间差，非永久缺口） |
| dsh | `dsh/bridge/runner-config.json` | 无（回落共享 spec） | 无本地命令位 | — | 同上 | 同上 |
| qoder | `qoder/bridge/qoder-config.json` | 有 | 无本地命令位 | — | 同上（另有 candidate/rc 系列历史 config，不作为取值源） | 同上 |

| 表外平台（第七个及以后） | 探测 `<id>/bridge/<id>-config.json` → `<id>/bridge/runner-config.json` → `<id>/bridge.json` | 回落共享 spec | 无本地命令位 | — | 未实勘，槽位未知 | staging 导出 + 同构插件包（D-162）；放置为人工步骤，登记为 BP-2 时间差，待该平台接口确认后正式入表（D-158） |

> **D-158（2026-10-15）**：表外平台不再抛 `ENTRY_SKILL_SLOT_UNKNOWN`，一律按「无本地命令位」处理并走 staging 导出——接纳第七个平台是生产路径（`platform-body.mjs`）。`platformId` 为空或非法时仍 fail-closed。

> **D-162（2026-10-29 实勘 + 实现）**：只写 staging 等于客户端拿不到 —— 实勘 `<local-user-path> 确有插件机制（`installed_plugins_v2.json` + `marketplaces` + `cache`，市场源 `https://qoder.cn/apphub/...`，当前仅装 `qoder-context@qoderapp-bundler`），而 qoder 国际版的 /wf /wfa 由工作区级 `qoder/plugins/ai-workflow-hub/`（`.qoder-plugin/plugin.json` + `skills/{wf,wfa}/SKILL.md`）承载；`qoder-cn/` 下没有 `plugins/` 目录。因此除 staging 外再导出一份**同构插件包**到 `<id>/runtime/entry-skills-export/plugin/ai-workflow-hub/`，并在 `summary.pluginPackage.placementHint` 给出放置路径。**管理台不写平台目录、不改客户端插件状态** —— 客户端是否读取工作区级插件位属该客户端自身的性质，未确认前登记为 BP-2 时间差，不谎报可用。

模板真身：`architecture-manager/src/runtime/entry-skills/{wf,wfa}/SKILL.md`（占位符形态，随安装包分发）。
渲染产物（staging，不入平台目录）：`architecture-manager/runtime/tmp/entry-skills-render/<platform>/...`。

## 与旧版用户级文本的口径差异（模板已按现行治理文本重写）

1. 删除「交稿级求解器链转 zcode」平台特例——AGENTS.md 2026-09-22 起数模与其它工作流等同，环境需求按 BP-1 §1.6 三选一归属声明。
2. 删除「提示先执行 integration-plan S1–S5」历史引用——改为「先完成本平台的一键接入配置」。
3. 删除「本机 bash 不可用」平台私有环境事实——改为「走本平台声明的 shell」。
4. 新增选版顺序与 run-lock 钉版说明（与 zcode 特化文本及 invocation-adapters-spec 对齐）。
