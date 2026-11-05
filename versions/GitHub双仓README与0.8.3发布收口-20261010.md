# GitHub 双仓 README 与 0.8.3 发布收口

P1/P2/P3 按既定判据完成：两仓详细 README、当前说明、0.8.3 公共源码与必需资源已入库正常推送，两仓稳定 Release 均包含便携/安装包、中文离线指南、RELEASE 元数据与 SHA-256 清单。

正文直接解释架构用途、三仓职责与版本区别、第一次操作、wf/wfa 调用条件、完整接入、AI 维护交接点、skill/agent 依赖更新、手操及恢复。当前 Codex 实测与其他平台待补分开；没有宣称完整认证、业务模型阶段、全软件派发或开发全量套件通过。

公开边界核对：未导入私有 Git 历史、平台配置/状态、凭据、本体、环境或备份；原有 21,738 个公开冻结文件逐字不变。v0.8.1 与既有各发行的资产 ID/大小/digest 保留；v0.8.1 tag 仍指向原提交。

228 个 src 文件与两个 EXE 包逐字一致，并对公开提交中的全部 24,268 个校验条目复算；各新附件的 GitHub SHA-256 与本地一致。两个 EXE 从登记备份真实恢复核对，未重复执行安装器。相关 35 项管理台回归/11 项 checker 检查沿用本轮修复实证，文档维护未虚构新业务 run。

推送中发现公开 ignore 将应用源码目录 src/runtime 一并判为忽略；已仅为该源码路径加例外，保留平台 runtime/凭据/本体的排除，并重算受影响清单后提交。此项解决的是源码发布阻断，不改变运行能力或平台认证。

## 入库四读数

发布时私有 HEAD：`dfbab5683c71c042e379e4bb7a1375b6f2eedf50`；公开 HEAD：`ea11a675d550c2e8d51ac9d70f433653640d1185`。两仓白名单 git status 为空，global status 也为空，origin/main 与 GitHub main 均等于各自 HEAD。

可回滚基线：`62385c5d8d8b4c840f082ab7bf4e1cdb8a7a02e9`，提交时间 `2026-10-10T19:36:51+08:00`；首次新发布 `2026-10-10T12:06:51Z`，基线早于发布。本轮无删除、覆盖旧发行或其他破坏动作，因此“入库时间早于破坏时间”无对象；旧版保留已核对。

这份收口文本另作正常提交；其提交后的最终 HEAD/status/远端读数由所属平台 FINAL-READBACK.json 回读保存，Git 日志可定位收口提交，不在文件中自引用尚未产生的 commit。

- [公开 0.8.3](https://github.com/MC-freshman/ai-workflow-architecture/releases/tag/v0.8.3)
- [私有 0.8.3](https://github.com/MC-freshman/ai-workflow-architecture-governance/releases/tag/v0.8.3)

维护性质：agent/workflow=null，未执行专家业务工作流。
