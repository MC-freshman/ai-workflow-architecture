# Protocol / contract versioning (§7.2 three layers)

Do not conflate:

| 层 | 示例 | 何时变化 |
|---|---|---|
| 架构版本 | 2.0.0 | 全系统接口/边界/保证基线变化 |
| 包版本 | `runtime-contracts 1.0.0`（本包），runner 某新版本 | 对应资源内容发版 |
| 协议标识 | `ai-run-protocol/v1.1` / `v1.2` / `v2` | 请求与状态语义变化 |

"架构 2.0.0" 不推导 "runner 必须 2.0.0"，也不要求所有资源同号。

## v1 preservation (不变量兼容, §4.2)

本包 `1.1/` 下的 protocol / run-lock / state / event / transaction 与 `common` 是从 `repo-lint 0.2.1` **逐字节冻结迁入**的 v1 形状，行为与 1.0.0 基线一致；旧 run 仍按锁内 `repo-lint` 契约解释。迁移只改变**归属**（不再是 repo-lint 自嵌），不改变 v1 语义。

## v2 additions (本包新增，C2 才由 runner 消费)

- `error-envelope.schema.json`（`ai-run-error/v2`）：统一机器可读错误信封。
- `platform-descriptor.schema.json`（`ai-platform-descriptor/v2`）：声明式平台身份 + 能力分面，取代 schema 内 platform 六值枚举。
- 协商：runner 与平台各声明支持协议集合，取交集；无交集 `UNSUPPORTED_PROTOCOL`，有协议无操作 `UNSUPPORTED_OPERATION`。同一 run 中途不换协议/契约、不重解析 current。

## §7.4 兼容矩阵（消费者须遵守）

| 场景 | 处理 |
|---|---|
| 旧客户端+旧 runner+旧契约 | 原样，旧 run 按原锁运行 |
| 新客户端+旧 runner | 只用双方明确支持的操作；不发 v2 字段 |
| 旧客户端+新 runner | 显式 legacy 接口，只承诺兼容套件行为 |
| 新客户端+新 runner+新契约 | v2 全部已认证能力 |
| v2 run 被旧 runner 打开 | 明确拒绝；只读导出，不改状态 |
| v1 run 需恢复 | 用锁内原 runner/契约恢复，新版本不得原地转换 |

无法无损映射的请求返回版本/能力不支持；不吞字段假装兼容。
