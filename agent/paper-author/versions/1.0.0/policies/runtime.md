# runtime

本域的来源与实测事实（2026-09-25，3.3.0 P6）：

- 上游池：`tool/_registry/skills-nature-skills.json` 348 个真实主题 + `skills-math-modeling-skill.json`
  44 个（paper-*）。语言分布实测为 268 英文 / 76 中文 / 0 日文，其中 8 个是极短件（<200 B）。
  编号骨架（`nature-00-scope`、`-01-research-canon`、`-02-evidence-table`、`-04-section-contracts`）
  本身就是 192–339 B 的薄卡，因此场景卡引用的是各主题的实质卡，不是编号骨架。
- 场景卡的每段引文都是源卡正文的逐字片段，并标注了所引小节标题与卡字节数；`SOURCE.json` 记 `verbatimFrom`。
- 4 张源卡用 `../../` 指向自身发布目录之外（D-94）：它们被入锁但未被引用，
  因为按路径现取会拿到一个没有钉版的东西。
- 平台侧事实沿用 `qoder/bridge/capabilities.json`：脚本面 `kernel-sandbox`，共享三仓在 jail 内只读；
  窗口上限（256k / 1m）本平台未实测，记在 `unverified["profile:windowProfile"]`。
