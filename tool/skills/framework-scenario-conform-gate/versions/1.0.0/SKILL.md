# framework-scenario-conform-gate

跑判据、算成本、决定要不要新增一步

> 场景技能：`framework-author` 的 `conform-gate` 场景选中它时，本文进提示词上下文。
> 正文来源只有三类：本仓治理文本原文、上游技能卡原文（标注语言）、本轮带证据文件的实测读数。
> 上游 ECC 池对本域只有旁证价值：38 个命中里 6 个是占位件、16 个正文是日文，架构规程本身它们一个字没写。

## 全矩阵只在两个时刻跑

首次平台接入、引擎/契约大版本升级。其余一律增量：新增或升级一个复用已声明能力 Profile 的资源
＝索引追加 + `--only <id>` 单格冒烟，**零平台改动、零全矩阵、零逐平台重认证**（BP-3）。

## 本轮实测的单格成本

`repo-lint 0.6.0 --select agent:<id>@<ver>`：**27 s / closure 15–41 资源 / checkedFiles 61**；
三仓全量：约 3 分钟 / 1,850 资源 / 7,117 文件。单格是量级上可用的日常闸。

## 平台结论不互抄

各平台用自己的 config 独立复验同一判据集；一台的 pass 不是另一台的 pass（BP-2）。
跨平台差异只能写成**时间差 + 待补台账**，不得写成"本平台不支持"或永久分层。

## 上游旁证

- `ecc-loop-design-check@1.0.0`（原文语言：英文，12492 B）
    "Design a goal-oriented agent loop, and review it for the ways loops go wrong — spinning and burning tokens, Goodhart-gaming the verifier, or running a wrong answer to completion. Two actions: (1) WRITE a loop — gate whether to build it, define a machine-decidable goal, pick the loop type, pick a skeleton; (2) REVIEW a loop — run it past five failure modes plus decidability, boundaries, fallback,

## 停下来拒绝的情形

- 没有有序 P 表（`P1…Pn`）的架构更新**不构成实施授权**，只能落为议题（BP-5）。
- 要改已发布版本目录里的字节：拒绝。新版本必须新建语义化目录并经 `current.json` 切换（BP-1、红线 1）。
- 破坏性动作之前没有可回滚的 commit：停手先提交（BP-6）。
- 结论要写进治理文本或对外宣告，但证据不可回读、或哈希/指针读数缺失：按谎报处理，不写（红线 3、BP-6）。
- 想为某个领域在根级新建一级目录、或在平台目录内另建平行功能面：未经授权一律停（BP-1）。
