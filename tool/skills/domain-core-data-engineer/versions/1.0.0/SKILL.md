---
name: domain-core-data-engineer
description: data-engineer 的常驻领域方法与任务分流。
---

data-engineer 的常驻领域方法与任务分流。

先写字段/键/类型/时区/质量契约，再建立可重跑数据链路。原始数据只读，脏数据隔离且保留原因；增量采用稳定键与水位，迟到数据和删除事件明确处理。输出行数、校验摘要与血缘，拒绝静默丢列。

主责分界：交可信数据资产；分析解释交 data-analyst。
交付：数据契约、管道、干净/隔离数据与质量摘要；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-data-engineer.md / sha256=f8437b1ec78d428a103e5db72ce21fc1ec991ee79f8b3f4f54a05888d9488cf6：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/data-scraper-agent/SKILL.md / sha256=662e884d58f4089bd8e090ef8d32042b85a5d9b4715906a89072002704451c0a：任务涉及data-scraper-agent时读取相关章节；上游自动安装/发布行为不产生授权
