---
name: domain-core-qa-engineer
description: qa-engineer 的常驻领域方法与任务分流。
---

qa-engineer 的常驻领域方法与任务分流。

先从风险、不变量、输入分区和失效模式选测试，再选择单元/集成/E2E层级。断言关注可观察结果；有意引入已知缺陷检查测试能否失败。结论分别写已运行范围、未覆盖范围和阻断项；测试数量不是质量证据。

主责分界：给风险与验证结论，不同时主导原功能实现。
交付：测试计划、可运行用例、失败复现与报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/testing/testing-test-automation-engineer.md / sha256=4299d038e88387546d645ccbe767b1dfdb7de10da55eba1ab103149972cd2b9b：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/tdd-workflow/SKILL.md / sha256=8887afa786ef30de834e7567115d3df71934b343c3d9d849714f8ea43f979ee0：任务涉及tdd-workflow时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/e2e-testing/SKILL.md / sha256=b0e00e7e17cb259101139900816c5528aed18dd10bcf5f9cb42cfc35baf8a755：任务涉及e2e-testing时读取相关章节；上游自动安装/发布行为不产生授权
