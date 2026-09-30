# framework-scenario-run-discipline

run 钉版、档位与跨会话续跑

> 场景技能：`framework-author` 的 `run-discipline` 场景选中它时，本文进提示词上下文。
> 正文来源只有三类：本仓治理文本原文、上游技能卡原文（标注语言）、本轮带证据文件的实测读数。
> 上游 ECC 池对本域只有旁证价值：38 个命中里 6 个是占位件、16 个正文是日文，架构规程本身它们一个字没写。

## 每 run 必钉版并落盘

agent / workflow / 技能 / 能力包 / 环境解析全部固定，写入所属平台
`runtime/runs/<run-id>/run-lock.json`；专家内部调用服从精确 `tool-lock`，
本平台默认覆盖**不得**改变共享 `current`，也不得绕过专家锁。

## 档位口径对全部工作流统一

未写档位＝草稿（只做点名范围，不 INIT 已有项目、不重跑求解/扫描、不冻结）；
写「过图」才跑非严格 QA；写「交稿」才走全部阶段并冻结。未达交稿档不得称"已验证/已冻结"。
红线不因最小量、对等或无缝而削减。

## 续跑等价（BP-4 两项，缺一即未满足）

① 续跑版本一致性校验，不一致须明确警告或拒绝，**不得静默换版**；
② 可回读的带 sha256 交接载体（`handoff-bundle/v1` 或用户指定共享路径），任何平台不得直读别平台 `runtime/`。
进行中的单个 run 不做在线热迁移，这是设计边界不是缺口。

## 上游旁证

- `ecc-strategic-compact@1.0.0`（原文语言：英文，6570 B）
    Suggests manual context compaction at logical intervals to preserve context through task phases rather than arbitrary auto-compaction. Use when a session is approaching a context limit and a task phase is a natural place to compact.
- `ecc-contract-first@1.0.0`（原文语言：英文，9521 B）
    Use when multiple consumers and providers must evolve an API or event schema without field drift, integration surprises, or one side silently redefining the interface.

## 停下来拒绝的情形

- 没有有序 P 表（`P1…Pn`）的架构更新**不构成实施授权**，只能落为议题（BP-5）。
- 要改已发布版本目录里的字节：拒绝。新版本必须新建语义化目录并经 `current.json` 切换（BP-1、红线 1）。
- 破坏性动作之前没有可回滚的 commit：停手先提交（BP-6）。
- 结论要写进治理文本或对外宣告，但证据不可回读、或哈希/指针读数缺失：按谎报处理，不写（红线 3、BP-6）。
- 想为某个领域在根级新建一级目录、或在平台目录内另建平行功能面：未经授权一律停（BP-1）。
