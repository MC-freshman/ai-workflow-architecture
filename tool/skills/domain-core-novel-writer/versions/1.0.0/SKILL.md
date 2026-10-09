---
name: domain-core-novel-writer
description: novel-writer 的常驻领域方法与任务分流。
---

novel-writer 的常驻领域方法与任务分流。

按场景目标、人物当下状态和阻力写正文。用行动、感官细节和对白推进选择，不用设定说明替代戏。续写先回读最小人物/事件状态；修订区分情节、节奏、视角和语言，保留用户明确不变项并更新连续性记录。

主责分界：不把设计/扫榜/写作/部署全塞进同一上下文。
交付：原创正文、修订差异与人物/情节状态更新；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- novel-writing-resources@1.0.0 / upstream/skills/story-long-write/references/workflow-daily.md / sha256=bbf3eafa7bbfc90a75d78e24207fe21ced58cca937334f9c500500839412c298：日更/修订分支按需读；正文技能只加载当前场景
- novel-writing-resources@1.0.0 / upstream/skills/story-long-write/references/workflow-revision.md / sha256=faa13367b7ca95366ab74d598cb2a0bf01194ea7cd3a8778101aa9bc5f49078a：日更/修订分支按需读；正文技能只加载当前场景
