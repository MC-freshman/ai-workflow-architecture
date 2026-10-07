# 管理台 0.5.6 接入链路修复记录（2026-10-07）

P1–P5 已按预定判据完成；P6 包/UI/文档通过，Git 收口读数另附。修复是管理台代码与新发布包，不代替六个平台的生产重新认证。治理维护 agent/workflow=null；业务工作流未在生产代跑，隔离测试使用真实 runner 的维护协议调用。

## 已处理

- D-105：按字段保护未保存草稿，回填现行配置；旧请求/旧对象不能覆盖当前对象。明确选择当前 WSL 值也记编辑，普通扫描不会复位。显式重新读取才丢弃草稿。
- D-106：peer 判据修正并提供安装模板 SHA 检查及可确认的组件更新；一键续接不复用旧 provider 的通过步骤。源码 95d48d8 的成功分支修补原本已存在，但不是完整修复，也不会自动更新安装副本。
- D-107：已有 hostEnvironmentManifest 时，用当前真实 Python 生成 runner 宿主标准库/导入依赖清单，原文件保留；配置与新清单一起有基线、审计和失败恢复。隔离脚本环境仍单独全量冻结/恢复。
- D-108：所有相关接入路径遵循实际软件网关指针。唯一旧绑定可迁移，冲突点名拒绝；六软件的位置、解释器别名、MCP 和凭据引用保留。
- D-109：安置后明确提示下一步，新增绑定到现行配方入口；不发布新版本。原有“发布新配方并绑定”并非本轮新增。绑定本体不等于版本兼容或 MCP/功能已验证。
- D-110：正式只读回读区分当前提交与历史入库，提供数量、分类和完整路径列表。BP-6 §6.3 不允许 runtime 运行产物入库，不能把历史文本直接刷成合规。历史清理另立方案；本轮没有删历史。
- D-111：接入 peer 探针真实 prepare→claim→确认 stop，失败/超时不亮绿。业务缺正文为 awaiting-input，未编正文。dsh 旧失败子任务的 claimReached=true 不能证明业务完成；旧证据原字节保留。

## 实测

完整 conform **215 项 / 214 pass / 0 fail / 1 skipped**，唯一未执行项是 WSL 子进程取消测试；没有把它算通过。digest：`2820dc35bdfc05b8e46aadbdca6988127bf347a27f111f594c932b331c990912`。

实际 0.5.6 便携 EXE 验证当前配置优先、900 ms 迟到回读、扫描刷新保留 Python/软件/WSL 草稿、明确丢弃草稿、真实 IPC/Worker 更新安装副本和保留旧文件名绑定。软件导入安置→恢复回读→绑定现行配方的 DOM/IPC/Worker 链也真实执行，配方指针与已发布字节不变。系统原生确认弹窗只在隔离夹具里由测试 SDK 回答，不冒充人工点击；安装程序没有在系统里安装，验证的是它内嵌与便携版相同的应用载荷。

195 个源码/界面文件与包内载荷逐 SHA 一致，unpacked Python 执行体一致；旧校验清单覆盖的 8 个 EXE 未改。dsh/qoder/zcode 原 automatic.json 与 P1 起点 SHA 全相同。本轮没有改钉子、换日志、代跑全平台矩阵或直接修改他平台配置。

| 新包 | SHA-256 |
|---|---|
| Architecture-Manager-0.5.6-portable-x64.exe | `c1668a35463daae1a19dc50404062c401a50a2a1083bac8b93e69b8b69f2c441` |
| Architecture-Manager-0.5.6-setup-x64.exe | `4b1af1c86de7831ed348a651f7cc8fff1a76b33b20690a3a636d1f2975dd96ac` |

产物在 architecture-manager/release；操作说明见 architecture-manager/docs/onboarding-0.5.6.md，维护证据在 codex/runtime/maintenance/20261007-onboarding-chain。

## 来源与边界

只读现况：dsh/qoder 接入日志 complete；zcode 停 capabilities。qoder 历史 runtime 入库 1114 件，zcode 1 件；未做历史清理。新版部署后，各平台应在管理台确认更新组件，再核对当前更改续接；不需要 AI 手补文件。zcode 本轮没有被代为宣布 complete。

归档基线测试 208 项中 201 pass/0 fail/7 skip，因归档位置缺失共享路径的 6 项另补测全部通过，剩余 WSL 未测；归档的 preload 检查未通过，没有冒充 conform 基线全绿。过程中抓到的增量摘要迁移回归已修：私有组件哈希与共享摘要迁移共用同一实现，没有为通过而降低判据。两项显式 IPC/写计划列表测试随新增绑定入口更新。

P1 操作曾误用 PowerShell 保留变量，导致基线归档临时落到用户目录；已核实创建时间与内容，仅将本轮新建的文件移回 Codex 私有维护目录，移动前后件数/字节数一致，记录在 P1-baseline-path-correction.json。没有修改用户既有内容。

预先回滚提交：根仓 606f8e9429d892f9bf4b8a3a2337b4250d238d4d；源码仓 60bbd53c2b1012f03216ff6cf7946173cbca977f。均先于本轮修复写入。测试/候选包在私有目录，旧发行包保持原位。
