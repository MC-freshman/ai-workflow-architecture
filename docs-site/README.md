# docs-site —— E:\ai 架构与治理文档站

把 `E:\ai` 的治理文本与三仓注册表读数构建为静态文档站（Docusaurus 3.10）。
**原文与注册表永远是事实来源；本目录里的 `docs/`、`generated/`、`build/` 都是生成物。**

## 快速开始

```bash
cd E:\ai\docs-site
npm install            # 一次性，约 1,409 个包
npm run build          # internal 全量档 → build/internal/
npm run serve          # 本地起服务（搜索需要它），http://localhost:3000
npm run conform        # 一条命令出 C1…C11 的 PASS/FAIL 与摘要
npm run probe:tilde    # 文件形式复核单波浪号转义与作者删除线语义
```

日常只改文档时：`npm run build` 一条就够（它按顺序跑 sync → generate → docusaurus build）。
开发预览热重载：`npm start`。

| 命令 | 做什么 |
|---|---|
| `npm run inventory` | 只读扫描 `E:\ai` 的 Markdown 面 → `data/inventory.json` |
| `npm run sync` | 按白名单把原文复制成 `docs/` 构建输入 + 来源锁 |
| `npm run generate` | 从三仓 registry 与各平台 `capabilities.json` 生成 `generated/` 参考页 |
| `npm run redact` | 凭据 / 危险路径 / 禁发布文件树扫描 |
| `npm run build:shareable` | 只含 `visibility: public` 条目的可对外产物 → `build/shareable/` |
| `npm run conform` | 集中判定（下节），报告落 `data/conform-report.json` |
| `npm run probe:tilde` | 不经过 shell 参数，复核源文档 `~~…~~`、单 `~`、同步 Markdown 和 HTML `<del>` 的对应关系，报告落 `data/tilde-probe.json` |
| `npm run clear` | 清 Docusaurus 缓存 |

## 目录职责

```
docusaurus.config.ts  sidebars.ts  tsconfig.json      站点配置
content/                                            站点撰写的导览页（进白名单，是源）
data/docs-manifest.json                             白名单：发哪些精选原文、什么状态、什么档位
data/exclude.json                                   排除清单，每条带理由
data/redirects.json                                 旧地址 → 现行页面
scripts/lib.mjs                                      同步期把单个 `~`（`BP-1~BP-4` 这类范围写法）转义为 `\~`
scripts/lib.mjs                                     共用：哈希、通配、front-matter、链接改写
scripts/{inventory,sync-docs,generate-reference,redact-check,docs-conform,build}.mjs
docs/            ← 生成物（sync-docs 产出，勿手改，.gitignore 已排除）
generated/       ← 生成物（generate-reference 产出，同上）
static/img/synced/  ← 生成物（原文里引用的图片复制位）
build/<profile>/ ← 产物
data/{source-lock,inventory,generated-report,redact-report,conform-report,build-*}.json ← 生成物
```

当前白名单共 45 篇：原有 30 篇精选治理文档、10 篇已接入平台的操作/调用说明、3 篇稳定治理工具说明，以及软件工程专家的提示词和运行策略各 1 篇。dsh 只保留自动生成的状态页，因其仍在排除清单中而不复制平台原文。

要改正文：改 `E:\ai` 原文，然后重跑 `npm run build`。**不要**改 `docs/` 或 `generated/`，会在下次生成时被覆盖。
要加一页：在 `data/docs-manifest.json` 加条目（`status` / `visibility` / `section` / `order` / `slug` 必填）。

## docs-conform 的十一条判据

| 判据 | 抓的是什么真失败 |
|---|---|
| C1 | 白名单结构（重复 id / slug、未定义 section 或 status） |
| C2 | 白名单点名的原文在盘上不存在 |
| C3 | 原文变了但没重跑同步（源 SHA-256 与来源锁不一致） |
| C4 | `docs/` 里出现白名单之外的文件（有人手改生成目录） |
| C5 | 同步来源命中排除清单（把 runtime / `_sources` / 本体拉进来了） |
| C6 | 参考页版本号与注册表 `current.json` 不一致 |
| C7 | 站内链接指向不存在的路由 |
| C8 | `当前有效` 页面链到提案页却不标"提案" |
| C9 | 正文被静默删改（除链接站内化外，原文逐行都要能在产物里回读） |
| C10 | 产物/源面出现私钥、AK、key、Bearer、JWT、URL 内嵌凭据等实值 |
| C11 | 产物不存在、页面数低于门槛，或**产物是旧的**（构建摘要与当前来源锁/注册表复算不一致） |

输出末行是一个 12 位摘要，便于把"同一份内容重复构建是否一致"当回归看。

`docs/` 与 `generated/` 是**按档位物化**的（shareable 只落 public 条目），所以 `docs-conform --profile X` 要紧跟在 `npm run build` / `build:shareable` 之后跑；C11 会把这件事判出来（产物摘要与当前来源锁不一致即 FAIL）。

## 与项目规则的关系

- **BP-1 三仓骨架不可变**：本站只**读**三仓 registry 并复算展示，不建平行版本面、不改任何指针。
- **BP-3 验收最小量**：全部机器可判项收敛进 `npm run conform` 一条命令；只保留能抓真失败的检查（例如"提到 `runtime/runs/`"在治理文本里属正常引述，故记为提示而非阻断）。
- **BP-6 入库先行**：`docs-site/**` 是否纳入根仓 git 白名单属**待授权**动作（要改根级治理文本）。本目录自带 `.gitignore`，不会把 `node_modules/`、`build/` 带进去。
- **BP-7 不可入库件**：`node_modules/`（1,409 包）与 `build/` 都是**可重建件**，重建配方 = `package.json` + `package-lock.json` + 一条 `npm ci`；`data/` 下的报告与来源锁是文本，随目录入库即可复算。
- **红线**：不发布各平台 `runtime/` 一手证据、凭据、软件本体；`software/phpStudy_64/` 明文禁止随任何产物分发（`data/exclude.json` 已登记）。

## 与原方案的偏差（两条，都有理由）

1. **脚本用 `.mjs` 而不是 `.ps1`**：站点本身必须依赖 Node/Docusaurus，同一套脚本只用一个运行时，`npm run conform` 才能在 CI 与本机同口径复算。
2. **架构版本用状态徽章而不是 Docusaurus 版本选择器**：`1.0.0 / 2.0.0 / 3.0.0 / 3.1.0` 在这里是**文档主题**，不是站点的历史快照；徽章能让"某文档正文是历史、但其中某节仍是现行载体"这种情形说清楚。真要冻结整站阅读面时再启用 `docs:version`。

## 已知限制

- 搜索需要静态服务器；`file://` 直开可浏览但搜索不可用。
- 英文未建：中文是事实版本，翻译单独维护状态，避免两语言语义漂移。
- 当前白名单为精选治理层（30 条）＋六个平台操作文档＋3 个稳定治理工具说明＋1 个稳定通用专家说明；工作流与其它专家正文暂缓扩列，三仓仍以自动目录展示。
- Mermaid 图由 `@docusaurus/theme-mermaid` 在构建期打包，产物离线可用；原文里几乎没有 Mermaid，图是本站在导览页里补的。渲染在浏览器端完成，静态 HTML 骨架里只有容器。
- 中文正文的 `**粗体**，` 收尾按 CommonMark 的 flanking 规则不成立（后面跟全角标点时星号会原样露出），故两个文档实例都挂了 `remark-cjk-friendly`。这是中文站的必需件，不是可选美化。
- 治理文本里的 `~` 用来写范围（`BP-1~BP-4`、`P0~P10`），同段两个单 `~` 会被 remark-gfm 解析成删除线并吞掉中间整段。同步期由 `scripts/lib.mjs` 的 `escapeLoneTildes()` 把单个 `~` 转成 `\~`，所以同步下来的 Markdown 一个字都不用改；作者真要的 `~~删除线~~` 不受影响。`npm run probe:tilde` 会用文件形式复核这条语义边界。
