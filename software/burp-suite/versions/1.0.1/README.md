# Burp Suite Pro (MCP Server)

## 概述

本释放件接入本机 Burp Suite Professional 2024.5.1 的原生 MCP Server。实测传输是 **SSE**：先对 `http://127.0.0.1:9876/` 建立 `text/event-stream`，服务端返回带 `sessionId` 的同源 endpoint，再通过该 endpoint 发送 JSON-RPC。连接器会为每次调用建立有界会话，不把 Burp JAR 当作 CLI 子进程启动。

## 已冻结的能力

- `mcpListTools`：读取冻结清单对应的 `tools/list`。
- `mcpCallTool`：调用冻结清单内的具体工具；参数先按 live snapshot 内的 inputSchema 校验。当前实测清单包含 25 个工具，清单摘要见 `capabilities.snapshot.json#runtime.toolsSha256`。

`proxyHistory` 和 `scannerScan` 仍保留为声明历史兼容位，但在本版本中是 pending：live 清单虽有 `get_proxy_http_history`，其参数语义尚未与旧 schema 完成映射；live 清单也没有启动主动扫描的工具，只有读取既有 scanner issues。连接器会在派发前返回 `CAPABILITY_UNAVAILABLE`，不会把读取问题冒充扫描。

## 审批边界

Burp MCP 面板中的 HTTP 请求审批、项目数据访问审批和凭据过滤继续保持开启，配置编辑工具保持关闭。只读 `url_encode` 已完成真实 `tools/call` 往返验证；本轮没有发送 HTTP 请求、访问项目数据、启动扫描或写入配置。

## 启动

按平台安装位启动 Burp 并启用 MCP Server，监听 `127.0.0.1:9876`。用户也可以继续使用现有 `CN_Burp(无CMD窗口).VBS` 启动入口。配方只校验本体哈希，不搬运商业软件本体。

## 版本与平台

- 配方版本：1.0.1
- 上游版本：2024.5.1
- Windows：已按本机安装位实测；Linux/macOS：`untested`，没有借用 Windows 路径。
- 旧释放件 `1.0.0` 保持不变；新释放件发布与 `current` 指针切换是两个动作。
