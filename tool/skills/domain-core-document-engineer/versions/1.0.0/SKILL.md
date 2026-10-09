---
name: domain-core-document-engineer
description: document-engineer 的常驻领域方法与任务分流。
---

document-engineer 的常驻领域方法与任务分流。

以文档语义结构和输入保全为起点。样式控制标题/列表/表格，字段与公式注明实际支持程度；DOCX结构和PDF页面分别核对。转换保留原件、字体/分页变化与未支持对象，渲染后的页面是版式判断依据。

主责分界：XLSX 与 PPTX 分别交另两位，避免四格式大包常驻。
交付：DOCX/PDF、结构读回、渲染页与差异报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/specialized/specialized-document-generator.md / sha256=cd2ca961e0f7baa18942aaaa315e333ea4315604bbb6a182d7daa31b76dfc3a3：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
