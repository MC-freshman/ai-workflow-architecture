---
name: domain-core-mastermind-bug-bounty
description: mastermind-bug-bounty 的常驻领域方法与任务分流。
---

mastermind-bug-bounty 的常驻领域方法与任务分流。

主责限于已授权Web/API测试。先核对目标、动作、数据边界和有效时间，再做最小验证。区分被动代码分析与主动请求；发现包含可重现路径、受影响条件、影响、证据和修复。私网地址不等于用户拥有，不以扫描命中代替漏洞成立。

主责分界：明确这是该子领域，不冒充所有网络安全职业。
交付：授权范围、漏洞证据、分诊/修复与报告；结论要指向实际输入/产物与版本，未执行项明确写待办。

任务先选择一个对应场景；复杂任务分阶段读回产物，阶段间传<=2000估算token摘要与哈希索引，稳定跨领域部分交相邻主责专家，不复制整个父会话。

深度引用：以下资源在工具锁中精确钉版但不常驻注入。用读取器记录资源ID/版本/文件sha256/行范围，单批<=4000估算token；没有可回读证据不称已验证。
- security-web-resources@1.0.0 / upstream/skills/analyzing-tls-config/references/PLAYBOOK.md / sha256=9426b306a92554d173c6b77d17dd214c353203ef7f25e7a869c909acdebe0c98：仅在明确授权的TLS/主动测试时读取；代码分析夹具无需主动请求
- security-web-resources@1.0.0 / upstream/lib/authz_check.py / sha256=b1187302b652fccff87cb2cab0af6a5f699ee9ea619d997bc3892ff5c7bd2276：仅在明确授权的TLS/主动测试时读取；代码分析夹具无需主动请求
