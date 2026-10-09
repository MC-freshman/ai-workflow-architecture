# AI Workflow Architecture

Versioned AI workflows, expert agents and software recipes, with a local Architecture Manager.

本仓是架构的唯一公开入口，私有治理仓是唯一维护源。`tool / agent / software` 三共享仓的目录、职责、版本指针、冻结封条和精确依赖锁保持独立；GitHub 托管收敛为两个仓库不改变三仓骨架。

| 内容 | 入口 |
|---|---|
| 架构规则与现状 | [AGENTS.md](AGENTS.md)、[HANDOFF.md](HANDOFF.md)、[基本原则](versions/架构基本原则.md) |
| 工作流与技能 | [tool](tool/README.md) |
| 专家 | [agent](agent/README.md)：28 位现行主责专家，7 个兼容旧入口；[2026-10-09 扩充记录](versions/专家扩充与上下文控制-收口报告-20261009.md) |
| 软件配方 | [software](software/README.md)，本体由各平台自行安装 |
| 管理台源码 | [architecture-manager](architecture-manager/README.md)，源码版本 0.8.1 |
| 已发行 Windows 安装包 | [Releases](https://github.com/MC-freshman/ai-workflow-architecture/releases)，迁移已有 0.3.1–0.7.0；没有在本轮新发布 0.8.1 安装包 |
| 文档站源码 | [docs-site](docs-site/) |
| 1.0.0 独立参考快照 | [历史参考](versions/reference-1.0.0/README.md)，保留 Apache-2.0 与原始 NOTICE |
| 仓库合并与旧链接映射 | [GITHUB-REPOSITORIES.md](GITHUB-REPOSITORIES.md) |

共享治理工具现行指针：`wf-runner 0.13.0`、`repo-lint 0.7.0`、`runtime-contracts 1.6.0`、`architecture-ops 1.6.0`。具体采纳和能力判据以各平台自己的记录为准，源码发布不等于平台接入完成。

```bash
git clone https://github.com/MC-freshman/ai-workflow-architecture.git
cd ai-workflow-architecture
sha256sum -c REPOSITORY-SHA256SUMS
```

管理台开发要求 Node >=24，进入 `architecture-manager/` 后按其 package.json 和使用手册安装依赖、运行与构建。现成 EXE 在 Releases，运行不要求开发 Node。

公开内容仅为治理文本、共享资源、接入面和管理台源码；凭据、各平台 runtime、软件安装目录、环境、本地备份与缓存均不进入公开树，也不导入私有 Git 历史。来源、导出边界与历史脱敏版本差异见 [PUBLICATION-BOUNDARY.md](PUBLICATION-BOUNDARY.md)、[EXPORT-MANIFEST.json](EXPORT-MANIFEST.json) 和 [PUBLIC-RELEASE-PROVENANCE.json](PUBLIC-RELEASE-PROVENANCE.json)。旧公开导出曾脱敏部分冻结软件配方，本轮保留既有公开字节并明确它们与私有正本的差异。

既有 MIT / CC-BY-4.0 声明继续适用于原导出内容；第三方资源各自 LICENSE/NOTICE 优先，历史参考为 Apache-2.0。管理台原独立仓未声明单独许可证，本次合并不另授许可。
