# Architecture Manager 0.8.1

本地架构工作区的 Windows 图形管理台。管理资源、平台配置、软件接口、计划、Git 和备份；涉及写入的操作先生成计划，再由用户确认执行。

普通使用者请阅读 [安装与首次使用](../docs/quick-start.md)、[操作手册](../docs/user-guide.md) 和 [0.8.1 更新说明](../docs/releases/0.8.1.md)，可直接下载正式 EXE，无需从源码构建。

开发者使用 Node >=24，在本目录执行：

```text
npm ci
npm start
```

测试与 Windows 构建命令：

```text
npm test
npm run conform -- --out <自己的输出目录>
npm run package:win
```

目录：src 为应用源码，test 为回归，scripts 为构建和检查工具。派生输出 dist/release 与 node_modules 留在本地。完整环境、命令和验证范围见 [开发说明](../docs/development.md)。

管理台版本与共享资源版本独立。许可见仓库 [LICENSE](../LICENSE)，不要把共享资源许可推定为管理台的单独授权。
