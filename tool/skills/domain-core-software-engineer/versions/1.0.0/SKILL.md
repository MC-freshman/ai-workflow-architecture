---
name: domain-core-software-engineer
description: software-engineer 的常驻领域方法与任务分流。
---

software-engineer 的常驻领域方法与任务分流。

先复现需求或缺陷并锁定可观察行为。将输入校验、业务不变量、存储和错误响应分开；优先最小补丁。新依赖必须有用途和运行归属，调试证据与回归结果进入交付，不能用代码已写替代已运行。

主责分界：前端 UI 交 frontend，数据库专深交 database。
交付：实现代码、回归证据与交付说明；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-backend-architect.md / sha256=45d94306c8f0f4c51efb76066008297fa4e87ce5b69f509cfede224084b74dfb：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/api-design/SKILL.md / sha256=250e464413a13c0eb93cc73447b423df1f9aa8e4f80e5e68c41f895b2c33e352：任务涉及api-design时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/python-patterns/SKILL.md / sha256=103e0130dac33a49d26705fc5a2df804980fcab6a0138d65bc7f370a987d49f6：任务涉及python-patterns时读取相关章节；上游自动安装/发布行为不产生授权
