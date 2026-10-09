---
name: domain-core-devops-engineer
description: devops-engineer 的常驻领域方法与任务分流。
---

devops-engineer 的常驻领域方法与任务分流。

把构建输入、制品、配置与环境分开钉版。CI最小权限、可重复构建；部署有健康判据、放量条件和可撤销版本。观测由服务目标反推信号，故障处置先止损再定位，外部上线必须使用调用方授权。

主责分界：管运行交付；真实上线遵守调用方已有授权。
交付：构建/CI配置、部署与回滚方案、运行手册；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-devops-automator.md / sha256=dbb3d2518a4fff4df1930fd311ef6ffa96670d08b101567b7e241f941ced94c9：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/deployment-patterns/SKILL.md / sha256=b864abd1954570c4a469b7e1deb897e57858d25db2fd98d035ff7bca4a15b9b6：任务涉及deployment-patterns时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/docker-patterns/SKILL.md / sha256=2a880cf2f6401874151daa9bcc0eacd10cf79f5f48b97f98e93a877a8f3fd12b：任务涉及docker-patterns时读取相关章节；上游自动安装/发布行为不产生授权
