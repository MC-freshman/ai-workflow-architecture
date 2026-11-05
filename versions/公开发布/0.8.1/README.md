# AI Workflow Architecture · 架构管理台 0.8.1

在自己的电脑上管理 AI 工作流、专家、技能和软件配方。架构管理台提供 Windows 图形界面，可查看资源、生成变更计划、接入客户端、更新配置，以及停止、继续和恢复操作。

**[下载 0.8.1](https://github.com/MC-freshman/ai-workflow-architecture/releases/tag/v0.8.1) · [安装与首次使用](docs/quick-start.md) · [操作手册](docs/user-guide.md) · [更新说明](docs/releases/0.8.1.md)**

## 下载

本发行提供 Windows x64 的两种包，功能相同：

| 文件 | 适合的使用方式 |
|---|---|
| [便携版](https://github.com/MC-freshman/ai-workflow-architecture/releases/download/v0.8.1/Architecture-Manager-0.8.1-portable-x64.exe) | 下载后直接启动 |
| [安装版](https://github.com/MC-freshman/ai-workflow-architecture/releases/download/v0.8.1/Architecture-Manager-0.8.1-setup-x64.exe) | 安装到自己选择的位置 |
| [SHA256 清单](https://github.com/MC-freshman/ai-workflow-architecture/releases/download/v0.8.1/SHA256SUMS-0.8.1.txt) | 核对下载文件 |
| [中文指南](https://github.com/MC-freshman/ai-workflow-architecture/releases/download/v0.8.1/Architecture-Manager-0.8.1-Guide.zh-CN.md) | 离线查看首次使用步骤 |

运行管理台 EXE 不需要开发用的 Node/npm。客户端接入、脚本执行和软件调用所需的环境，由你在自己的工作区中配置。

## 能做什么

- **资源管理**：查看和导入专家、技能、工作流及软件配方；发布新版本，预览默认版切换或回退。
- **平台接入**：选择自己的客户端和解释器，预览配置并执行接入；分别显示配置、能力检查和真实客户端验证结果。
- **统一更新**：对已有有效配置的平台预览“一键更新所有平台”，核对差异后执行；保留停止、继续和恢复记录。
- **软件接入**：登记 CLI、GUI 或已有 MCP 服务，发现真实接口后按参数预览调用。
- **本地治理**：查看文档、计划和审计记录，按选定路径提交 Git，并管理经过恢复核对的备份。

管理台是本地工作区工具。模型服务、厂商登录和软件本体由使用者自行准备。配置保存、窗口启动、能力检查和业务执行分别显示结果。

## 首次使用

1. 下载便携版或安装版，并用 SHA256 清单核对。
2. 获取本仓的 [0.8.1 工作区源码](https://github.com/MC-freshman/ai-workflow-architecture/archive/refs/tags/v0.8.1.zip)，解压后选择包含 `tool/`、`agent/`、`software/` 和 `AGENTS.md` 的根目录；也可以用 Git 克隆。
3. 启动管理台，点击“选择工作区”。等待只读扫描结束后，在“资源”查看内容。
4. 需要连接自己的客户端时，进入“平台与接入”，选择或新增平台，填写程序、解释器和所需配置。先预览，再确认执行。

详细步骤、Git 克隆和升级方法见 [快速开始](docs/quick-start.md)。本仓不预装作者的客户端配置、环境或凭据；首次扫描没有已接入平台是正常起点。

## 内容结构

```text
tool/                    工作流、技能、能力包和治理工具
agent/                   专家定义与精确依赖锁
software/                软件配方和网关定义
architecture-manager/    0.8.1 管理台源码、开发脚本和测试
docs/                    安装、操作、开发与发行说明
versions/                通用架构原则和用户接入登记入口
scripts/                 仓库文件完整性检查
```

`tool / agent / software` 各自保留 registry、current、版本目录、SHA256 和依赖锁。管理台 **0.8.1** 是应用版本，各资源具有自己的版本号；完整版本信息见 [RELEASE.json](RELEASE.json)。

## 进一步阅读

| 目的 | 文档 |
|---|---|
| 安装、首次打开、升级与文件校验 | [快速开始](docs/quick-start.md) |
| 导入资源、接入客户端、更新和恢复 | [操作手册](docs/user-guide.md) |
| 三仓结构、版本与能力边界 | [架构说明](docs/architecture.md) |
| 从源码运行、测试和构建 | [开发说明](docs/development.md) |
| 0.8.1 的变化与已知边界 | [发行说明](docs/releases/0.8.1.md) |
| 数据、凭据、反馈与许可 | [数据与许可](docs/data-and-license.md) |

源码或工作区文件下载后，可以运行 `python scripts/verify-checksums.py` 核对整仓清单。程序包的校验与源码清单分别提供。许可范围见 [LICENSE](LICENSE)，第三方目录内的 LICENSE/NOTICE 优先。
