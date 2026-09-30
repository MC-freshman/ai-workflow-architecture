# framework-scenario-governance-edit

改治理文本并保证全仓自洽

> 场景技能：`framework-author` 的 `governance-edit` 场景选中它时，本文进提示词上下文。
> 正文来源只有三类：本仓治理文本原文、上游技能卡原文（标注语言）、本轮带证据文件的实测读数。
> 上游 ECC 池对本域只有旁证价值：38 个命中里 6 个是占位件、16 个正文是日文，架构规程本身它们一个字没写。

## 上位与从属

`versions/架构基本原则.md`（BP-1~BP-7）是上位；`agents.md` 其余条款与它冲突时**以它为准并回改本文件**。
口语裁决先登记在基本原则 §9，再落到条款正文；已定稿版本原文不改（`架构1.0.0.md` 为冻结历史基线）。

## 自洽检查（R16 常开）

治理文本对同一事实有五处复述（`agents.md`、`AI_ARCHITECTURE_SYSTEM_PROMPT.md`、总手册、
`versions/平台接入清单.md`、`HANDOFF.md`）。改一处必须五处同查；本轮的做法是让机检比对复述与权威块，
漂移即 error。**裁决裁掉的东西要写成显式撤销句**，不能只删不记——删掉后读者只会去找它。

## 撤销型修订的写法（本轮实测样本）

BP-4 由三项机制裁为两项时，落地文本同时写了：裁减依据（实测前提，不是推定）、被撤销三项的原文、
已实现机制保留但**作用域如实声明为同一平台内**、以及**明写的代价**
（同一项目副本被两个客户端同时开工不会被任何机制发现）。缺任何一项都会读成"能力更强了"。

## 上游旁证

- `ecc-living-docs-governance@1.0.0`（原文语言：英文，8482 B）
    "Keep a long-lived project's documentation from rotting by assigning existing project docs clear constitution, map, status, and history roles, then wiring the active agent harness to those canonical sources. Use in the maintain phase when docs drift from code, agents lose context between sessions, or intentional removals keep being recreated. Prefer adopting the repository's current docs structure
- `ecc-unified-memory@1.0.0`（原文语言：英文，6008 B）
    Share durable, inspectable context and handoffs between Claude, Codex, Hermes, Cursor, OpenCode, and other agents through the local ECC Memory Vault. Use when an agent must save work state, transfer context, resume another agent's task, or search shared project knowledge.

## 停下来拒绝的情形

- 没有有序 P 表（`P1…Pn`）的架构更新**不构成实施授权**，只能落为议题（BP-5）。
- 要改已发布版本目录里的字节：拒绝。新版本必须新建语义化目录并经 `current.json` 切换（BP-1、红线 1）。
- 破坏性动作之前没有可回滚的 commit：停手先提交（BP-6）。
- 结论要写进治理文本或对外宣告，但证据不可回读、或哈希/指针读数缺失：按谎报处理，不写（红线 3、BP-6）。
- 想为某个领域在根级新建一级目录、或在平台目录内另建平行功能面：未经授权一律停（BP-1）。
