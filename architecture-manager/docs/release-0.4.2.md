# 0.4.2 修复与提速补丁

下载：GitHub Release [v0.4.2](https://github.com/MC-freshman/architecture-manager/releases/tag/v0.4.2)，用其中的 SHA256SUMS-0.4.2.txt 核对（服务端 sha256 与 2026-10-03 本机包逐字相同）。0.4.1 包未覆盖。2026-10-04 本机 `release/` 清理旧版本后仅保留 0.5.0，0.4.1/0.4.2 历史包以 GitHub Releases 为回退副本。

实际便携 EXE 六条界面/IPC 链通过：启动和 Worker 扫描、文档 Git 差异、发布计划、认证范围、所选平台软件连接器健康、Git 查询。打包验收修复了 Electron 冻结 preload 与 Proxy 任务包装的不兼容，避免启动扫描失败。双包的内部 app-64.7z 哈希一致，所有打包 src 文件对齐本次 conform 源码 SHA。

conform 共 134 项，133 PASS / 1 SKIP / 0 FAIL，digest `4b2dfbfa790f96a42bda88adf3279421e0a355250e73e8ce28121c179c099144`。唯一 SKIP 为未配置 WSL 的 Linux 后代取消。发布预览现在真正到达后端，非法模板被明确拒绝；合法从零模板和完整本体导入在 P9–P18 继续完成。

已有有效首检的 Codex 在实际 EXE 中可回读 52 格原证据，本次范围 0 格，不能称为刚重跑 52 格。新性能配对需要用户在管理台选择、预览、确认配置；共享 current 和生产配置没有自动改变。两格三次中位提速见 P7-batched-certification.md；不是全矩阵固定耗时承诺。

软件 READY 表示该平台绑定和快照满足声明的派发条件；健康查询没有执行 MySQL 查询或其它业务功能。安装包仅检查内载荷与便携包一致，没有代用户执行系统安装。

本轮是 P8 可用补丁交付，0.5.0 四类本体接入尚未完成。请参照 README 打开自己的工作区；开发者运行时为 Node >=24，终端开发依赖不要求普通用户安装。
