# MCP 工具契约草案

V1.0 已提供 `scripts/mcp_server.py` 的依赖无关 stdio 实现。以下是工具接口；外部 MCP
客户端仍应把工具不可用明确标记为 `NOT_AVAILABLE`，不能伪造调用结果。

## 推荐工具

| 工具 | 输入 | 输出 |
|---|---|---|
| `project_init` | 项目 ID、语言、入口 | 项目目录和阶段状态 |
| `project_doctor` | 无 | 项目结构、规格和状态警告 |
| `inspect_dataset` | 项目内相对文件路径 | 数据字典、质量问题、审计产物 |
| `run_experiment` | 项目内配置、输出目录、超时 | 实验 ID、环境、哈希、日志和产物 |
| `validate_experiment` | 项目内验证配置 | `PASS/FAIL/NOT_RUN` 明细 |
| `check_figures` | 图表登记表路径 | 图表尺寸、格式、裁切风险和警告 |
| `check_pdf` | PDF 和可选编译日志 | 文件完整性、页数和编译警告 |
| `check_lineage` | 结果登记表路径 | 输入、代码、配置和证据哈希状态 |
| `freeze_project` | 项目内 manifest 路径 | manifest、复现说明和交付清单 |
| `stage_status` | 无 | 当前阶段和阻塞原因 |

## 工具不变量

- 工具使用相对路径并限制工作目录；
- 每次运行返回机器可读状态和人可读摘要；
- 不覆盖原始数据和已冻结结果；
- 运行失败必须保留日志；
- 工具只执行用户授权的本地项目操作。

## 启动

```text
python scripts/mcp_server.py --project E:/path/to/modeling-project
```

通信使用每行一个 JSON-RPC 2.0 消息。服务启动参数中的项目根目录是唯一允许写入的
范围；工具参数中的路径必须是该根目录内的相对路径。
