# 用户工作区协作约定 · 0.8.1

开始维护前阅读 AI_ARCHITECTURE_SYSTEM_PROMPT.md 和 agentic-workflow-master-manual.md；架构原则入口为 versions/架构基本原则.md。

- tool、agent、software 是三个共享仓。保留 registry/current/语义化 versions/SHA256SUMS/精确依赖锁，已发布版本只读。
- 本模板没有已经接入的个人平台。新增客户端目录须经工作区所有者明确授权并同步治理登记；能力结论由使用者在自己的平台独立验证。
- 客户端配置、软件本体、环境、凭据、缓存、日志和运行产物归所属平台；不得加入共享版本或上传到公开仓。
- 运行开始钉住资源及依赖版本，运行锁与事件写入所属平台 runtime。跨客户端续跑通过带哈希的交接载体校验版本，不静默换版。
- 架构迁移、更新和发布先给有序 P 表；每块产物完整落盘，可安全停手。破坏性操作前提交可回滚基线。
- Git 按本轮明确路径提交，不混入无关改动；推送前扫描凭据、本体和大文件。禁止强推。
- 软件与环境备份按平台登记并经真实恢复核对。未写档位按草稿范围执行，不把配置、准备或调用性检查冒充业务完成。

工作区允许的初始目录为 tool、agent、software、architecture-manager、docs、scripts、versions。个人平台与 inbox 由所有者通过明确计划创建和登记；所有者自定路径，不预设作者机器路径。操作说明见 docs/user-guide.md。
