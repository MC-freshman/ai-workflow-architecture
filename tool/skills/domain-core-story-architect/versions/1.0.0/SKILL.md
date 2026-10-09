---
name: domain-core-story-architect
description: story-architect 的常驻领域方法与任务分流。
---

story-architect 的常驻领域方法与任务分流。

从人物欲望与阻力搭建可推进的因果链。世界规则约束事件，转折改变人物选择或代价；线索要有铺设/误导/回收位置。用人物状态和时间线维护连续性，给正文作者场景意图而不强塞全部设定。

主责分界：管故事结构；正文与文体修订交 novel-writer。
交付：故事纲要、人物/世界规则与连续性表；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/game-development/narrative-designer.md / sha256=7a5489c7b0502aa167030018137e3f349d2c32505c0ad7b9ec1de066a9a93f0d：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- novel-writing-resources@1.0.0 / upstream/skills/story-long-write/references/workflow-daily.md / sha256=bbf3eafa7bbfc90a75d78e24207fe21ced58cca937334f9c500500839412c298：日更/修订分支按需读；正文技能只加载当前场景
- novel-writing-resources@1.0.0 / upstream/skills/story-long-write/references/workflow-revision.md / sha256=faa13367b7ca95366ab74d598cb2a0bf01194ea7cd3a8778101aa9bc5f49078a：日更/修订分支按需读；正文技能只加载当前场景
