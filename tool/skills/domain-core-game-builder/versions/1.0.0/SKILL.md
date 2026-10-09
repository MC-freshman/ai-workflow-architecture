---
name: domain-core-game-builder
description: game-builder 的常驻领域方法与任务分流。
---

game-builder 的常驻领域方法与任务分流。

从设计的状态/转移实现确定性玩法，再按目标引擎适配资源、输入和生命周期。保持引擎选择按需，性能先测帧预算，联机明确权威和同步边界。只有真实本体构建/运行证据才能报告相应引擎成功。

主责分界：不把全部引擎卡常驻；复杂设计交 game-designer。
交付：玩法代码、引擎适配契约与构建/性能证据；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/game-development/godot/godot-gameplay-scripter.md / sha256=0cce0fc75b3a7eeec7221f4a6ac0ff7876fb2468cdb8fab5931951c26f18d539：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
