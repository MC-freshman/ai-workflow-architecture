# AI Workflow Architecture

Versioned AI workflows, expert agents and software recipes, with a local Architecture Manager.

把散落在多个 AI 客户端里的工作流、专家与软件，收进三个带版本锁的共享仓（`tool / agent / software`），用一台本地桌面应用统一管理。

## 这是什么

- **给谁用**：在多个 AI 客户端／平台之间维护工作流、专家与软件配方，希望它们有版本、可追溯、可回滚的个人与小团队。
- **解决什么**：配置散落各处、改动无记录、出错难回滚——统一收进带版本指针与冻结封条的共享仓，改动走"计划制"。
- **怎么做到**：本地管理台对工作区做**只读盘点** → 生成写入**计划预览** → 你**确认后才执行** → 写入后回读校验并留**哈希审计**，需要时可**回滚**。

## 快速上手（只用 EXE，不需要开发环境）

1. 到本公开仓 [v0.9.1 Releases](https://github.com/MC-freshman/ai-workflow-architecture/releases/tag/v0.9.1) 下载 portable 版 exe（免安装，双击即用）；安装版内置三仓 seed，适合新空工作区。
2. 启动后点右上角「选择工作区」，选中你的架构工作区目录。
3. 等左上角状态条提示扫描完成，再按各面板提示操作——所有写入都会先弹出计划预览，确认后才落盘。

界面默认暗色主题，右上角可切换亮色。

## 治理与结构

本仓是架构的唯一公开入口，私有治理仓是唯一维护源。`tool / agent / software` 三共享仓的目录、职责、版本指针、冻结封条和精确依赖锁保持独立；GitHub 托管收敛为两个仓库不改变三仓骨架。

| 内容 | 入口 |
|---|---|
| 架构规则与现状 | [AGENTS.md](AGENTS.md)、[HANDOFF.md](HANDOFF.md)、[基本原则](versions/架构基本原则.md) |
| 现行命名基线 | [架构 3.7.0](versions/架构3.7.0.md)：治理基线收编与工程化闭环 |
| 工作流与技能 | [tool](tool/README.md) |
| 专家 | [agent](agent/README.md)：28 位现行主责专家，7 个兼容旧入口；[2026-10-09 扩充记录](versions/专家扩充与上下文控制-收口报告-20261009.md) |
| 软件配方 | [software](software/README.md)，本体由各平台自行安装 |
| 管理台源码 | [architecture-manager](architecture-manager/README.md)，源码版本 **0.9.1** |
| 现行 Windows 安装包 | 本公开仓 [v0.9.1 Releases](https://github.com/MC-freshman/ai-workflow-architecture/releases/tag/v0.9.1)：portable / setup 双包、`SHA256SUMS-0.9.1.txt`、中文指南四资产；0.3.1–0.9.0 历史版保留在 [Releases](https://github.com/MC-freshman/ai-workflow-architecture/releases) |
| 文档站源码 | [docs-site](docs-site/) |
| 1.0.0 独立参考快照 | [历史参考](versions/reference-1.0.0/README.md)，保留 Apache-2.0 与原始 NOTICE |
| 仓库合并与旧链接映射 | [GITHUB-REPOSITORIES.md](GITHUB-REPOSITORIES.md) |

共享治理工具现行指针：`wf-runner 0.13.1`、`repo-lint 0.7.0`、`runtime-contracts 1.6.0`、`architecture-ops 1.5.2`、`platform-conformance 1.6.3`。具体采纳和能力判据以各平台自己的记录为准，源码发布不等于平台接入完成。

管理台源码门禁：`npm run conform` 五段（lint → preload → runtime-drift → governance-drift → tests）。2026-11-13 用户终端读数 **495 例 / 493 pass / 0 fail / 2 skip / valid=true**（digest `c63b33ab…`，对应第二轮更新前源码）；发布后权威读数见私有治理仓 `versions/架构与管理台第二轮更新收口记录-20261113.md`；公开仓内容经白名单导出，门禁读数以维护源为准。文档站另有 internal / shareable 两档 `docs-conform`，与管理台门禁互不混用。

```bash
git clone --branch v0.9.1 https://github.com/MC-freshman/ai-workflow-architecture.git my-ai-workspace
cd my-ai-workspace
sha256sum -c REPOSITORY-SHA256SUMS
```

管理台开发要求 Node >=24，进入 `architecture-manager/` 后按其 package.json 和使用手册安装依赖、运行与构建。现成 EXE 在 v0.9.1 Releases，运行不要求开发 Node。

公开内容仅为治理文本、共享资源、接入面和管理台源码；凭据、各平台 runtime、软件安装目录、环境、本地备份与缓存均不进入公开树，也不导入私有 Git 历史。安装包只作独立 Release 资产，不进入 git。来源、导出边界与历史脱敏版本差异见 [PUBLICATION-BOUNDARY.md](PUBLICATION-BOUNDARY.md)、[EXPORT-MANIFEST.json](EXPORT-MANIFEST.json) 和 [PUBLIC-RELEASE-PROVENANCE.json](PUBLIC-RELEASE-PROVENANCE.json)。旧公开导出曾脱敏部分冻结软件配方，本轮保留既有公开字节并明确它们与私有正本的差异。

既有 MIT / CC-BY-4.0 声明继续适用于原导出内容；第三方资源各自 LICENSE/NOTICE 优先，历史参考为 Apache-2.0。管理台原独立仓未声明单独许可证，本次合并不另授许可。
