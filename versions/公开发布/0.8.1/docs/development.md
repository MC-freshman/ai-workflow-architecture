# 从源码运行与构建

本快照固定为管理台 0.8.1。应用代码位于 architecture-manager，采用 Electron、React、Node IPC 和工作进程。开发依赖由 package-lock.json 锁定。

## 环境

- Node.js 24 或更高版本及 npm。
- 构建 Windows 包使用 Windows x64。
- 平台接入或脚本业务另行准备自己的解释器、客户端及所需软件。

## 运行

```text
cd architecture-manager
npm ci
npm start
```

npm start 先生成 preload、管理桥、检查源码并构建 UI，再启动 Electron。选择你自己的测试工作区，不把开发目录当作个人生产平台目录。

## 检查

```text
npm test
npm run conform -- --out <你自己的检查输出目录>
```

conform 汇总静态检查、接口声明、模块边界、事务和相关回归，并输出 pass/fail digest。实际执行或跳过的项以当次报告为准，不用本仓发行结果代替个人环境的检查。

在仓库根目录运行下面的命令，可核对本次源码快照的逐文件清单：

```text
python scripts/verify-checksums.py
```

这个脚本只读文件，不连接平台，不运行工作流。Windows 也可使用 py 命令启动。

## 构建 Windows 包

```text
npm run package:win
```

输出到本地 architecture-manager/release，包含 portable 和 setup 两种 x64 包。Electron 构建工具可能需要下载构建依赖；依赖和派生目录不进入源码 Git。首次环境安装不保证离线可用。

本发行公开附件使用已经核对的原始 0.8.1 构建：225 件源码/构建资源及两包内嵌 ASAR 均与来源记录绑定。应用代码没有为此次说明整理重新改版。没有声称新编译能逐字复现 EXE，也没有在使用者的生产环境执行安装器。

修改应用代码时创建新版本与新包，不覆盖 v0.8.1 或共享仓已经冻结的版本目录。许可范围见 [LICENSE](../LICENSE)。
