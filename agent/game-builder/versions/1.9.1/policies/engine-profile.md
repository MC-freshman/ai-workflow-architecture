# 引擎档（engine profile）

- **policy**: `engine-selection`（machine-checkable declaration moved out of tool-lock by Z10 §2C-B）
- **statement**: 项目引擎（Godot/Unity/Unreal）必须在任务开始时显式选定且互斥；未选定不得假设引擎，也不得混用引擎 API。
- **migratedFrom**: `tool-lock.profiles.engine = required-and-mutually-exclusive`
- **reason**: 引擎在 0.6.0 之前硬编码只接受 `renderer=matplotlib-adapter-first` 一种 profile；本声明以策略文件形式保留
  （语义弱化为提示词层约束，不再由引擎阻断），待 engine 0.6.0 的声明式 profile 落地后再迁回锁内。
- **review**: 2026-09-14
