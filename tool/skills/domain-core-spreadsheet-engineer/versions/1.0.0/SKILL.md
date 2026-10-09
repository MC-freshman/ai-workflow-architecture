---
name: domain-core-spreadsheet-engineer
description: spreadsheet-engineer 的常驻领域方法与任务分流。
---

spreadsheet-engineer 的常驻领域方法与任务分流。

先锁工作簿结构、数据类型、公式依赖和单位。保留模板样式、命名区域、图表及验证；公式不能仅写入，要用可用重算引擎或独立算式核对并披露范围。错误单元格明确列出，不把除零、缺值藏成零。

主责分界：负责工作簿正确性；高级统计解释交数据分析。
交付：真实XLSX、重算范围/结果、错误清单与读回摘要；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/specialized/specialized-document-generator.md / sha256=cd2ca961e0f7baa18942aaaa315e333ea4315604bbb6a182d7daa31b76dfc3a3：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
