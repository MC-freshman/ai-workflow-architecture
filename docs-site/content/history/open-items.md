# 当前开放事项与待补台账

这里只放**已登记、未闭合**的事项。每条给出处，不在此重述判据；判据以各文档自己那节为准。

## 一、平台侧（BP-2：结论不互抄，各自出证）

| 事项 | 现状 | 出处 |
|---|---|---|
| 七平台现行钉版 | 七个平台目录（codex / dsh / workbuddy / zcode / doubao / qoder / qoder-cn）的 `bridge.json` 均钉 runner `0.13.1`，平台 config 的 contracts/scanner 均为 `1.6.0/0.7.0` | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| qoder-cn 入驻 | journal **11/11 步 complete**（native 为 auxiliary），矩阵 **92 PASS / 0 FAIL** | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| workbuddy / doubao | workbuddy `configured-pending`（native 待补）；doubao `waiting-user` | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| 其余平台旧 journal | codex / dsh / zcode / qoder 的旧 journal（9 步或更早）属 pre-criteria，不按 10-28 新口径映射为完成 | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| `profile:administrator` | **有意保留**的唯一 declaredAbsent：常驻提权属红线，带 90 分钟路径与"每次调用当次同意"的闭合形态，不为凑零而声明 | [3.0-Q 实施表](/docs/architecture/qoder-3.0-q) |

## 二、框架侧待补

| 事项 | 现状 | 出处 |
|---|---|---|
| 当前开放缺陷 | D-123 / D-124 / D-127 / D-152 / D-163 / D-173 / D-174–D-177；缺陷簿 172 行、open 10 / unverified 1 | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| D-174–D-177 | 平台副本漂移 / 备份区膨胀 / LX 链接残留 / 缺脚本化重建入口；D-174 的 P3/P4 重铺尚未执行 | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| 全量 → 增量哈希 | 成本项，2.1 起按 run 一次权威哈希后增量复用 | [2.1.0 定稿实施表](/docs/history/2.1.0-final-plan) |
| `repo-lint` 版本对齐例外 | 已重新定性为版本对齐问题，缺口在 D04 只读绑定下闭合 | [1.0.0 接入状态](/docs/architecture/1.0.0-integration-status)、[平台接入清单](/docs/architecture/platform-checklist) |

## 三、跨平台与备份

| 事项 | 现状 | 出处 |
|---|---|---|
| 跨平台资源仲裁 | **已撤销为必需项（2026-09-22）**：平台中立状态层 / 跨平台互斥 / 并行一等能力不再要求；锁表作用域如实声明为同一平台内。同一项目被两个客户端同时开工不会被发现，会互相覆盖 | [运行契约速览](/docs/runtime/orientation)、[基本原则 BP-4](/docs/architecture/basic-principles) |
| 共享侧旧版本删除（Wave 1） | 2026-10-30 直接删除 62 个未引用内容层旧版本 / 9,550 文件，不迁入 `inbox`；29 个架构引擎/治理旧版本保留；回滚依赖根仓 git raw blob | [平台接入清单 §8.33](/docs/architecture/platform-checklist) |
| 不可入库件的备份演练（BP-7） | 可入库件已做过一次真实恢复演练并留证；密封脚本环境这类件**没演练过就按未备份处理** | [基本原则 BP-7](/docs/architecture/basic-principles) |
| `inbox` 终局（U5）与 `claude code` 目录（U4） | 仍按登记项处理：`inbox` 不自动发现、不执行、不直接删除；`claude code` 未自动纳入正式平台接入面 | [工作区规则](/docs/quick-start/workspace-rules) |

## 四、本站自身的开放项

| 事项 | 现状 |
|---|---|
| `docs-site/` 入库 | 已在根仓白名单；当前白名单 **54 条**（含 2026-10-30 新增的 3.6.0 基线页） |
| 英文版本未建 | 中文是事实版本；英文需单独维护翻译状态，避免语义漂移。届时把 `'en'` 加进 `docusaurus.config.ts` 的 `i18n.locales` 并跑 `write-translations` |
| 站点级版本选择器未启用 | 架构版本在这里是**文档主题**，用状态徽章区分；要冻结某一天的整站阅读面再切 site version |
| 收录范围 | 精选治理层 + 三仓自动生成目录；`tool` 下各资源 README、各平台 `bridge/platform.md` 平台章仍按白名单逐条纳入 |
| 搜索需要静态服务器 | `npm run serve` 或 Nginx/Caddy/GitHub Pages；`file://` 直开可浏览但搜索不可用 |
