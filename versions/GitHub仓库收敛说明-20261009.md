# GitHub 架构仓库收敛（2026-10-09）

维护：私有 [ai-workflow-architecture-governance](https://github.com/MC-freshman/ai-workflow-architecture-governance)。公开源码、文档与下载： [ai-workflow-architecture](https://github.com/MC-freshman/ai-workflow-architecture)。

三共享仓 tool / agent / software 的职责、目录、版本、冻结字节与钉版机制原样保留。architecture-manager/ 改为私有根仓维护的普通源码目录，公开仓只接受白名单文件导出，禁止导入私有 Git 祖先或强推。环境继续由所属平台管理；本轮使用已有解释器，不安装新环境。

| 原仓 | 去向 |
|---|---|
| ai-workflow-architecture-governance | 保留私有，唯一维护源；包含当前架构与管理台源码及完整管理台 Git 祖先 |
| ai-workflow-architecture | 保留公开，现行白名单导出；原公开提交历史继续保留 |
| architecture-manager | 源码在 architecture-manager/；既有公开发行迁至公开仓 manager-v<版本>；旧 Git 全 refs、元数据和发行附件已备份后删除 |
| ai-workflow-architecture-1.0.0-reference | 完整快照在 versions/reference-1.0.0/，原 LICENSE/NOTICE 与字节保留；公开发行迁为 reference-v1.0.0；原 Git/元数据/附件备份后删除 |
| ai-workflow-architecture-full | 当前共享源已在私有仓；旧 1.0.0 完整导出历史及附件以可恢复备份登记保留，避免重复导入旧导出树；原远端删除 |
| ai-workflow-architecture-evidence | 原始历史证据、Git refs 与附件在经恢复校验的 Codex 备份登记中保留，不重入源码索引；原远端删除 |

## 下载地址映射

原管理台 `architecture-manager/releases/tag/vX` 对应公开仓 `ai-workflow-architecture/releases/tag/manager-vX`，已迁移版本为 0.3.1、0.4.0、0.4.1、0.4.2、0.5.0、0.5.2、0.5.6、0.5.7、0.6.0、0.7.0。原附件名与 SHA256 不改。旧 URL 删除后不会自动跳转；现行下载入口统一为 [公开 Releases](https://github.com/MC-freshman/ai-workflow-architecture/releases)。历史文档中的旧 URL 是当时事实，配合本映射回读。

最新管理台源码是 0.8.1。本轮仅迁移上述已有安装包，不将本机 0.7.1 / 0.8.0 / 0.8.1 包冒充既有公开发行。管理台原仓无独立 LICENSE，历史参考保持 Apache-2.0，第三方资源保持各自来源许可。

## 备份与公开边界

备份为历史证据登记，载体在 inbox/backup/codex/github-consolidation-20261009/，不是现行运行依赖。含私有源与证据；未采集凭据/secret 值，不对外发布该备份。Git 镜像、完整本地 bundle、发行附件与元数据经过一次真实恢复，refs 与附件哈希一致。机器登记见 GitHub仓库收敛备份登记-20261009.json。

公开仓不含各平台 runtime、inbox、凭据、环境或本体安装目录，不带入私有 Git 历史。原公开导出曾对部分冻结软件配方作脱敏，本轮保留原公开字节并在 PUBLIC-RELEASE-PROVENANCE.json 明写与私有正本的差异；该继承问题不在本轮修改已发布封条来掩盖。
