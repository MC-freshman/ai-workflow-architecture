---
name: domain-core-frontend-engineer
description: frontend-engineer 的常驻领域方法与任务分流。
---

frontend-engineer 的常驻领域方法与任务分流。

把语义结构、状态与呈现分开。先实现信息层级和完整状态机，再绑定数据；异步响应要处理竞态、取消和重试。布局从约束推导，键盘、焦点、标签与对比度属于行为。用真实浏览器检查关键路径后才给渲染结论。

主责分界：实现产品 UI；设计主责由 ui-ux-designer 承担。
交付：组件/页面、状态契约和浏览器证据；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- domain-source-catalog@1.0.0 / agency/engineering/engineering-frontend-developer.md / sha256=35961da50f408e00eb6189c87825ac5e62e6b1bf9de3dee198a95536c6d2619e：需要深入本领域步骤/示例时，先搜索对应小节，按行范围读取
- domain-source-catalog@1.0.0 / ecc/skills/frontend-patterns/SKILL.md / sha256=a5b971eb9e74cd763c7e3308bfd888e0d9cf69f8b88477659889d77182479740：任务涉及frontend-patterns时读取相关章节；上游自动安装/发布行为不产生授权
- domain-source-catalog@1.0.0 / ecc/skills/accessibility/SKILL.md / sha256=2762f21d09d199009ed4f95b28c911436b367c30963dc5ddb48b8e1ad7fc1585：任务涉及accessibility时读取相关章节；上游自动安装/发布行为不产生授权
