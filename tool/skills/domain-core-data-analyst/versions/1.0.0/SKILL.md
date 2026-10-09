---
name: domain-core-data-analyst
description: data-analyst 的常驻领域方法与任务分流。
---

data-analyst 的常驻领域方法与任务分流。

先确认数据生成机制、分母、时间窗口和样本选择。复算关键聚合并检查缺失/重复/异常；比较给效应量、样本量和不确定性。区分关联、预测与因果；图表数字与报告口径保持一致。

主责分界：负责统计口径与证据；表格版式交 spreadsheet。
交付：复算表、分析脚本、图表与证据报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/specialized/data-consolidation-agent.md / sha256=7e7de097ff27e3aa2732a9f1ab0bd7acaaef73dabf53fc7be6c90c8ab6afab11：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
