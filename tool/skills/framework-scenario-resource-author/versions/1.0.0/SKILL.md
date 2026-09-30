# framework-scenario-resource-author

新建或升级一个共享仓资源（skill / workflow / agent / pack / software 配方）

> 场景技能：`framework-author` 的 `resource-author` 场景选中它时，本文进提示词上下文。
> 正文来源只有三类：本仓治理文本原文、上游技能卡原文（标注语言）、本轮带证据文件的实测读数。
> 上游 ECC 池对本域只有旁证价值：38 个命中里 6 个是占位件、16 个正文是日文，架构规程本身它们一个字没写。

## 必须照做的顺序

1. 先定归属：`tool`（工作流/技能/包/契约）、`agent`（专家）、`software`（配方，不放本体）三选一，
   或明确它属于某个平台的 `runtime/`（BP-1 §1.6 的三条路，必须写明选了哪条）。
2. 新版本＝新目录：`<repo>/<id>/versions/<新语义化版本>/`，**已发布目录一字不改**；
   需要旧版仍可解析时，用 `deprecated` + `supersededBy` 标注，不要置 `enabled:false`
   （那是硬开关，会让钉在旧版上的 run 解析不了）。
3. 逐版本 `SHA256SUMS` 必须**双向**回读：清单里每条都在盘上且哈希一致，盘上每个文件都在清单里。
   封完必须回读，不能只写不算。
4. `SOURCE.json` 写清 `derivedFrom` / `supersedes` / `releaseScope` / `openDeferred`；
   引用外部技能的，逐张记 `verbatimFrom` 与 `bodySha256`。
5. 目录/注册表追加条目，但**不翻 `current.json`**——发布与采纳是两套机制（本轮 P1…P4 全部如此）。
6. 用 `repo-lint --only <id>` 单格冒烟，不要一上来跑全矩阵（BP-3）。

## 上游旁证

- `ecc-skill-scout@1.0.0`（原文语言：日文，6428 B）；先搜再造
    新しいスキルを作成する前に、ローカル・マーケットプレイス・GitHub・Webの既存スキルを検索する。スキルの作成・ビルド・フォーク・検索を行う際に使用。
- `ecc-skill-stocktake@1.0.0`（原文语言：日文，9663 B）
    "Claudeのスキルとコマンドの品質を監査するためのツール。変更されたスキルのみを対象とした高速スキャンと、順次サブエージェントバッチ評価を使用した完全棚卸しモードをサポートする。"
- `ecc-spec-generator@1.0.0`：**占位坏件，不可引用** —— 其 description 原文即 `<what the agent should do>`。

## 本域的一条实测教训

`ecc-scenario-generator` / `ecc-spec-generator` 的 description 字面就是模板占位符
（`<what this scenario tests>`、`<what the agent should do>`）。**照抄这种卡＝把占位符当知识交付**；
新建任何卡前先回读它的正文，不能只看 id 和标题。

## 停下来拒绝的情形

- 没有有序 P 表（`P1…Pn`）的架构更新**不构成实施授权**，只能落为议题（BP-5）。
- 要改已发布版本目录里的字节：拒绝。新版本必须新建语义化目录并经 `current.json` 切换（BP-1、红线 1）。
- 破坏性动作之前没有可回滚的 commit：停手先提交（BP-6）。
- 结论要写进治理文本或对外宣告，但证据不可回读、或哈希/指针读数缺失：按谎报处理，不写（红线 3、BP-6）。
- 想为某个领域在根级新建一级目录、或在平台目录内另建平行功能面：未经授权一律停（BP-1）。
