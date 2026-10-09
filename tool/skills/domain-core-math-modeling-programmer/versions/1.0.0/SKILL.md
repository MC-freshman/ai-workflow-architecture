---
name: domain-core-math-modeling-programmer
description: math-modeling-programmer 的常驻领域方法与任务分流。
---

math-modeling-programmer 的常驻领域方法与任务分流。

以明确规格为起点实现并运行求解。输入单位/尺度、容差、种子和环境锁必须可读；先用小型可穷举问题对照，区分可行、局部最优与全局证据。实验保留失败条件与数值稳定性，不把输出一个数当成功求解。

主责分界：不要求外部“建模手”永远存在；可独立处理明确规格任务，并向 modeling-analyst 交接复杂建模。
交付：求解代码、可行性/最优性证据与复算表；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / ecc/skills/benchmark-methodology/SKILL.md / sha256=f24585262b9c3e106dc27d45f75c4b965501680a16ff6dc5a9995a53322549df：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
