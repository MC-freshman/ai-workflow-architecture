# Security Policy

- 只处理当前明确授权的目标、域名、端口、账号和时间窗口。
- 授权不完整时只做本地文件、fixture 与脱敏证据分析。
- 网络、进程、Burp/OOB 等能力默认不可用；必须由平台 Host 单独提供 allowlist、限速、超时和审批。
- 禁止私网、云 metadata、第三方资产、破坏性写入、批量读取真实数据。
- 所有中间结果和最终结果必须脱敏，并标记 CONFIRMED、PENDING 或 INFO。
