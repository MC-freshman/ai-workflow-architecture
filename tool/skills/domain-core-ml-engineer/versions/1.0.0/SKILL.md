---
name: domain-core-ml-engineer
description: ml-engineer 的常驻领域方法与任务分流。
---

ml-engineer 的常驻领域方法与任务分流。

先定义预测时刻、标签与可用特征，按时间或实体隔离训练/验证/测试。预处理仅在训练集拟合，和基线比较；指标按任务损失与类别代价选。部署接口包含版本、输入漂移与回退，不用测试集反复调参。

主责分界：管可训练模型；LLM/RAG/工具调用交 llm。
交付：训练代码、模型/数据摘要、评估与失效报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-ai-engineer.md / sha256=f25a69aad25acd35dd1d62e33d5a814f4a26b075d90f968b4d778452e53924d8：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/mle-workflow/SKILL.md / sha256=2497888dd543ca7bdf5d0cb4d90fce023eb2c1c14f860f0af8e8be42423131b4：任务涉及mle-workflow时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/pytorch-patterns/SKILL.md / sha256=168c8740f548414a75f576265ddb03329be98ed57f06c5edaf79c7cd4b6a9cf4：任务涉及pytorch-patterns时读取相关章节；上游自动安装/发布行为不产生授权
