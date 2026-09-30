# Burp Suite Pro (MCP Server)

## 概述
Burp Suite 是 Web 应用安全测试集成平台。本配方通过 PortSwigger 官方 MCP Server 扩展，以 Streamable HTTP（loopback）接入，覆盖代理历史、扫描、重放等能力类别。Burp 是 GUI 单例软件，需人工启动。

## 版本
- 配方版本：1.0.0
- 上游版本：Burp Suite Professional 2024.5.1
- MCP 扩展：burp-mcp-all-2024.5.1-compat.jar（28.6MB，已在 extensions/ 目录）
- 内置运行时：jre/（OpenJDK 21.0.2）
- 接入形态：**mcp-http（singleton）**，端点 `http://127.0.0.1:9876`

## 能力清单

| 能力 | MCP 方法 | sideEffects | consent | 冻结状态 |
|---|---|---|---|---|
| mcpListTools | tools/list | none | auto | 已冻结（协议标准） |
| mcpCallTool | tools/call（通用入口） | external | confirm-stage | 已冻结（协议标准） |
| proxyHistory | tools/call（代理类别） | external | confirm-stage | **pending**，待 live tools/list |
| scannerScan | tools/call（扫描类别） | external | confirm-stage | **pending**，待 live tools/list |

### 快照冻结（首次必做）
本配方发布时 Burp 未运行，具体 Burp 工具名（如 proxy_history、scan_create）**尚未冻结**。首次连通后必须：
1. 启动 Burp 并启用 MCP Server 扩展（监听 9876）；
2. 调用 `tools/list`，把工具名/描述/inputSchema 回填 `capabilities.snapshot.json`；
3. 补齐 proxyHistory/scannerScan 的 `frozenToolName`，将 snapshot 的 `frozen` 置 true；
4. 发布新版本配方（1.0.1 或 1.1.0）并一句话切换。

未冻结前两个语义化能力为 pending，prepare 时不可自动调用（只有 mcpListTools/mcpCallTool 协议能力可用，且 mcpCallTool 的 toolName 仍须在冻结清单内）。

## 启动方式
```
cd <softwareRoot>                       # <local-tool-body-path> V2024.5.1\BurpSuite V2024.5.1
set JAVA_HOME=<softwareRoot>\jre
jre\bin\java.exe -jar BurpSuite\burpsuitloader.jar -r
```
（等价于随包 `Start.bat`；另有 `CN_Burp.bat`/`EN_Burp.bat` 选择中英文界面，无 CMD 窗口版用 .VBS。）

启动后人工操作：Extensions → 确认 MCP Server 扩展加载 → 启用 HTTP 服务监听 127.0.0.1:9876。

## 并发与独占资源
- **instanceMode: singleton**——Burp 全平台单例
- **exclusiveResources**: `tcp:127.0.0.1:9876`（MCP 端口）、`burp-project-file`（项目文件）、`license-seat:1`（许可席位）
- **whenBusy: queue**——并发调用排队串行执行，不抢占
- **不支持并行**：多个工作流同时使用 Burp 时由网关串行化；这是 GUI 单例 + 固定端口 + 单席位决定的，已在 manifest 机读声明

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| BurpSuite\burpsuite_pro_org.jar | 核心（531MB） | 11f9bafac12184da |
| BurpSuite\burpsuitloader.jar | loader（1MB） | a77becf8727530e4 |
| BurpSuite\extensions\burp-mcp-all-...jar | MCP 扩展（28.6MB） | 4f19af77ffca2641 |
| jre\bin\java.exe | 内置 JRE 21.0.2 | 638a1fa85ec764d5 |

完整哈希见 `recipes/windows.json`。

## 自检语义
- 文件完整性检查：随时可跑（只读）
- MCP 端点探测（tools/list）：Burp 未启动/未启用扩展时不可达 → 自检记 **SKIP**（available-but-not-running），不计 FAIL；Burp 运行时该探测同时承担健康检查与快照核对（不一致 → SOFTWARE_DRIFT）

## 合规提醒
- 所有测试必须在明确授权范围内；scannerScan 主动扫描向目标发送大量请求，confirm-stage 且必须提供 externalBoundary（allowedHosts，禁止 `*`）
- 商业软件：配方只检测/校验，不自动下载、不搬运本体、不处理许可
- 登录凭据等只通过平台密钥位引用（credentialsRef），不落盘
