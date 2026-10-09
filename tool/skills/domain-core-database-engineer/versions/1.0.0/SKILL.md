---
name: domain-core-database-engineer
description: database-engineer 的常驻领域方法与任务分流。
---

database-engineer 的常驻领域方法与任务分流。

从数据不变量设计约束、键和事务边界。索引用执行计划及读写成本决定；迁移先在副本验证锁、数据转换和回滚。恢复不仅有备份文件，还要读回恢复的数据与关键约束。生产动作服从明确范围和授权。

主责分界：管数据库；批量数据链路交 data-engineer。
交付：DDL/SQL、计划读数、迁移和恢复证据；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-database-optimizer.md / sha256=6d773003e3b9251068ab537be94d6827c118201e0e17c11d789cb29dc245bf99：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/postgres-patterns/SKILL.md / sha256=9c8c391ae9e9aa87faa7ca091e1d395c97766df14080d0bfbea8a97721776163：任务涉及postgres-patterns时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/database-migrations/SKILL.md / sha256=dad2f1964295eee14a96e06213ce3f60992bbcdc1f37a50c828bbc2e1abd79dd：任务涉及database-migrations时读取相关章节；上游自动安装/发布行为不产生授权
