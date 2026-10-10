# 安装与首次使用 · 0.8.1

## 1. 选择程序包

从 [0.8.1 正式发行页](https://github.com/MC-freshman/ai-workflow-architecture/releases/tag/v0.8.1) 下载一个 Windows x64 包：便携版可直接启动；安装版允许选择安装位置。两者包含同一版应用。不要把 GitHub 的源码 ZIP 当作可运行程序。

同时下载 `SHA256SUMS-0.8.1.txt`。在下载目录打开 PowerShell：

```powershell
Get-FileHash .\Architecture-Manager-0.8.1-portable-x64.exe -Algorithm SHA256
```

安装版把文件名替换成 `Architecture-Manager-0.8.1-setup-x64.exe`。把输出与清单中的同名行比较，忽略大小写，64 位十六进制摘要应完全相同。

## 2. 准备自己的工作区

管理台程序与架构工作区是两件东西。程序包不包含个人客户端、软件本体或登录状态。

**不用 Git**：下载 [0.8.1 源码 ZIP](https://github.com/MC-freshman/ai-workflow-architecture/archive/refs/tags/v0.8.1.zip)，解压到自己选择的位置。打开这一层应能看到 `tool/`、`agent/`、`software/`、`versions/` 和 `AGENTS.md`。

**使用 Git**：安装并配置 Git 后，在自己选择的父目录打开 PowerShell 运行：

```text
git -c core.longpaths=true -c core.autocrlf=false clone --no-checkout --branch v0.8.1 https://github.com/MC-freshman/ai-workflow-architecture.git my-ai-workspace
Set-Content -LiteralPath .\my-ai-workspace\.git\info\attributes -Value '* -text' -Encoding ascii
git -C my-ai-workspace checkout v0.8.1
```

首次 checkout 前设置本地 attributes，保留冻结资源的原始字节，避免换行转换影响封条。这个设置只写入自己的 Git 元数据。固定 tag 会得到此次发行的源码快照。不要把工作区放进管理台安装目录，也不要直接选择某个资源子目录。

管理台的首次克隆入口也可使用本仓 HTTPS 地址，目标须是新的空目录；它读取该远端的默认分支。需要严格固定 0.8.1 时，使用上面的 tag 命令或版本 ZIP。

## 3. 启动和浏览

1. 启动便携 EXE，或完成安装后打开 Architecture Manager。
2. 点击右上角“选择工作区”，选择刚准备的根目录。
3. 等待扫描完成，在“资源”查看专家、工作流、技能及软件配方。
4. 进入“文档”阅读本工作区规则。扫描和预览计划不会执行资源业务。

本发行不携带作者机器的接入配置，所以最初没有已接入平台是正常状态。软件配方列表中的定义也不表示软件本体已安装。

## 4. 接入自己的客户端

在“平台与接入”选择或新增平台，准备自己的客户端程序、解释器、所需软件及 Git 身份。新增平台目录需要明确确认。依次预览配置、核对目标并执行；登录、系统授权和安装器交互在各自界面完成。

界面分别显示配置保存、环境准备、能力检查和真实客户端验证。待补项可暂缓后继续。具体表单顺序见 [操作手册](user-guide.md#接入自己的平台)。

如需使用 Git 保存个人平台配置，应使用自己的私有仓库及远端。不要向此公开仓推送本机配置、运行记录或凭据。

## 5. 从旧版升级

退出旧管理台后，用新包启动并重新选择原工作区；不要用本仓源码覆盖已有个人工作区。程序升级本身不替你切换共享资源或平台钉版。

需要更新资源接入时，在“平台与接入”预览“一键更新所有平台”，核对受影响配置与依赖后执行。先保存自己的 Git 基线和必要备份。遇到待补、失败或取消，按界面回读记录再继续；恢复只处理本次操作拥有的变更。

## 常见问题

| 现象 | 处理 |
|---|---|
| 无法识别工作区 | 选择包含三个共享仓和 AGENTS.md 的根目录，避免选中 ZIP 内的外层空目录 |
| 没有可选平台 | 在“平台与接入”新增自己的客户端；本仓没有预接入的个人平台 |
| 配方存在但功能不能调用 | 先准备所属平台的实际软件本体、环境和真实接口，再发现并绑定 |
| 提示基线已变化 | 保留外部修改，重新读回差异并预览，不连续点击覆盖 |
| 登录或系统权限未完成 | 在对应厂商或系统界面完成后，再回管理台继续 |

完整边界见 [0.8.1 发行说明](releases/0.8.1.md)。
