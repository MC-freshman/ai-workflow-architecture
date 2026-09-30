# DSH 平台章

> 维护者：仅 **dsh 会话**改本文件。其他平台不得改写。总框架：[../../HANDOFF.md](../../HANDOFF.md)
> 本文件由 zcode 会话于 2026-09-12 放了空架子。用户此前暂缓本平台；未验证前不得写成已接入 runner。

## 已有文件（事实，非验收）

- 机器配置：[bridge.json](bridge.json)
- 现有说明：[README.md](README.md)
- 历史 run 在 `../runtime/runs/`（旧记录不构成 runner 能力证明）

## 待本平台会话补全

1. 复核命令 / 插件 / 客户端是否仍能加载（旧资料曾提 `/send-agent`）。
2. 若恢复使用：入口接到数模档位（未写 = 草稿），产物只写 `../runtime/`。
3. 写明已验证能力；未跑通的不要写已接入。

## 本平台必须遵守（不需再发明）

隔离、版本锁、数模三档、禁止 INIT 清空已有项目：见总框架与 [../../invocation-adapters-spec.md](../../invocation-adapters-spec.md) §3.1。


## 2026-09-27 自证读数（3.x 修复轮 R-P6 期间，zcode 会话代跑，用户授权；codex/doubao 未动）

- 配置成套抬到当前配对代 **wf-runner 0.11.0 + runtime-contracts 1.5.0 + repo-lint 0.6.1**（抬前备份 `runtime/maintenance/20260927-dsh-selfcert/runner-config.before.json`）。
- 读数：1.5.0 套件 25 OK（6 skip）；conform 25 项 pass 0 / declaredAbsent 24 / unverified 1（digest `b8096652d08a`，gapPlan 已补 26 条补救路径）；配对代全矩阵 **PASS 0 / NEEDS-INPUT 1 / FAIL 45**——45 格全部 `CAPABILITY_UNAVAILABLE`（未声明密封脚本环境，引擎如实拒绝一切钉包释放），1 格 NEEDS-INPUT（repo-lint live 档需 jail 挂载）。
- **结论照旧成立：配置已接线 ≠ 能力已验收。** runner-protocol-prepare 保持 false；script/peer/software/MCP 面全部 declaredAbsent 且各带整数分钟补齐路径（`capabilities.json` gapPlan）。完整能力自证仍待 dsh 在其密封环境就绪后出具。
