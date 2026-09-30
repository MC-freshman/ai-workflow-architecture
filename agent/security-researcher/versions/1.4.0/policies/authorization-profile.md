# 授权档（authorization profile）

- **policy**: `explicit-target-authorization`（machine-checkable declaration moved out of tool-lock by Z10 §2C-B）
- **statement**: 每次运行必须由调用方给出明确目标与授权范围；未授权目标一律不动作，只做只读分析。
- **migratedFrom**: `tool-lock.profiles.authorization = explicit-required`
- **reason**: repo-lint 0.2.0 起 `peer-agent`/`subworkflow` 已条件解封，但引擎 0.6.0 之前 profile 白名单仍是硬编码的单一值；
  在引擎支持声明式 profile 前，本声明以策略文件形式保留（语义弱化为提示词层约束，不再由引擎阻断）。
- **review**: 2026-09-14
