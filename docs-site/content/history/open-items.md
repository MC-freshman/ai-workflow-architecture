# 当前开放事项与待补台账

这里只放**已登记、未闭合**的事项。每条给出处，不在此重述判据；判据以各文档自己那节为准。

## 一、平台侧（BP-2：结论不互抄，各自出证）

| 事项 | 现状 | 出处 |
|---|---|---|
| 其余五平台采纳 3.0 栈并自证 | 只有 qoder 完成平台侧采纳与出证；codex / zcode / doubao / workbuddy 各自的采纳由**它自己的会话**登记 | [3.0-Q 实施表](/docs/architecture/qoder-3.0-q)、[平台接入清单](/docs/architecture/platform-checklist) |
| 48 h 等待型观察窗口 | 等待型事项，归完成后的维护期，不阻塞任何 P 表收口 | [平台接入清单](/docs/architecture/platform-checklist) |
| `profile:administrator` | **有意保留**的唯一 declaredAbsent：常驻提权属红线，带 90 分钟路径与"每次调用当次同意"的闭合形态，不为凑零而声明 | [3.0-Q 实施表](/docs/architecture/qoder-3.0-q) |
| zcode 重建后缺口 | 脚本沙箱 / peer / MCP / 数模求解链未恢复；按 BP-2 是待补项，不是别的平台绕行数模求解链的理由 | [总框架](/docs/quick-start/handoff) |
| 门3 / 门4 的 qoder 列 | 2.0-G 那轮 P 表未排，登记为待补（D-21 口径） | [平台接入清单](/docs/architecture/platform-checklist) |

## 二、框架侧待统一修复

| 事项 | 现状 | 出处 |
|---|---|---|
| D-53 … D-64 十二条 | 3.0-Q 执行期新发现的**非阻断缺陷**，按 BP-5 只做登记，项目收口后统一另出修复方案（另立 P 表） | [3.0-Q 实施表](/docs/architecture/qoder-3.0-q) |
| 3.0-A 缺口地址簿 | 39 行，每条带 `路径:行号` 与整数分钟成本 | [文件地图](/docs/architecture/3.0.0-file-map)、[平台接入清单](/docs/architecture/platform-checklist) |
| 全量 → 增量哈希 | 成本项，2.1 起按 run 一次权威哈希后增量复用 | [2.1.0 定稿实施表](/docs/history/2.1.0-final-plan) |
| `repo-lint` 版本对齐例外 | 已重新定性为版本对齐问题，缺口在 D04 只读绑定下闭合 | [1.0.0 接入状态](/docs/architecture/1.0.0-integration-status)、[平台接入清单](/docs/architecture/platform-checklist) |

## 三、跨平台与备份

| 事项 | 现状 | 出处 |
|---|---|---|
| **跨平台资源仲裁未满足（C-8）** | 锁表只在平台内；跨平台需要单独授权，承 2.1-A 的 P8b 交接件 | [运行契约速览](/docs/runtime/orientation)、[文件地图](/docs/architecture/3.0.0-file-map) |
| 不可入库件的备份演练（BP-7） | 可入库件已做过一次真实恢复演练并留证；密封脚本环境这类件**没演练过就按未备份处理** | [基本原则 BP-7](/docs/architecture/basic-principles) |
| `inbox` 终局（U5）与 `claude code` 目录（U4） | 仍按登记项处理：`inbox` 不自动发现、不执行、不直接删除；`claude code` 未自动纳入正式平台接入面 | [工作区规则](/docs/quick-start/workspace-rules) |

## 四、本站自身的开放项

| 事项 | 现状 |
|---|---|
| `docs-site/` 尚未进根仓 git 白名单 | 站点目录已建立并只写自己的目录；要把 `docs-site/**` 纳入根仓白名单需修改根级治理文本，属**待授权**动作 |
| 英文版本未建 | 中文是事实版本；英文需单独维护翻译状态，避免语义漂移。届时把 `'en'` 加进 `docusaurus.config.ts` 的 `i18n.locales` 并跑 `write-translations` |
| 站点级版本选择器未启用 | 架构版本在这里是**文档主题**，用状态徽章区分；要冻结某一天的整站阅读面再切 site version |
| 收录范围 | 第一版只收精选治理层（30 条）＋三仓自动目录。`tool` 下各资源 README、各平台 `bridge/platform.md` 平台章尚未纳入 |
| 搜索需要静态服务器 | `npm run serve` 或 Nginx/Caddy/GitHub Pages；`file://` 直开可浏览但搜索不可用 |
