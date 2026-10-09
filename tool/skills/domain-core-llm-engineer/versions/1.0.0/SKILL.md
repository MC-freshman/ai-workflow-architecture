---
name: domain-core-llm-engineer
description: llm-engineer 的常驻领域方法与任务分流。
---

llm-engineer 的常驻领域方法与任务分流。

把生成、检索、证据和工具副作用分开设计。先固定可判定任务与数据集，再比较提示/RAG/工具方案。检索保留文档ID、段落、版本和召回证据；没有证据要弃答。工具参数验证、最小权限和幂等由宿主执行，不能信任模型自报成功。

主责分界：不以 LLM 代替应做的统计模型验证。
交付：RAG/工具规格、证据索引、评估集与质量报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-rag-pipeline-engineer.md / sha256=f356233aebe7c5c0c55c4625422c9d6e1f02f6206c7aceca694cd372b0cfb9c2：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/cost-aware-llm-pipeline/SKILL.md / sha256=2d6c19c2d21a473db8720c4f723f17d265eeec48f84614f0169be2df2fbe28ff：任务涉及cost-aware-llm-pipeline时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/eval-harness/SKILL.md / sha256=3a5339a5a80099a5c9d55da9b6c8e05a690f5befc6f78d779c75dd79d818ca07：任务涉及eval-harness时读取相关章节；上游自动安装/发布行为不产生授权
