# Nmap Network Scanner

## 概述
Nmap（Network Mapper）是网络发现和安全审计工具，用于端口扫描、服务识别、操作系统探测。本配方封装 Nmap 7.95 便携版的 CLI 接口。

## 版本
- 配方版本：1.0.0
- 上游版本：7.95
- 接入形态：cli-wrapper（per-run）
- 编译信息：nmap-liblua-5.4.6 openssl-3.0.13 libssh2-1.11.0 Npcap-1.79

## 能力清单与 argv 映射

### version（auto，只读自检）
```
nmap.exe --version
```
输出：文本，解析 `Nmap version (\d+\.\d+)`。

### scan（confirm-stage，外部网络）
```
nmap.exe -oJ - [-s{S|T|A|U|W|M}] [-p ports] [--top-ports N]
         [-sV] [-O] [-Pn] [-n] [-F] [-r] [--open]
         [-T0..5] [--host-timeout T] [--max-retries N] [-oN file] <target>
```

| JSON 参数 | argv 映射 | 类型 | 说明 |
|---|---|---|---|
| target（必填） | 位置参数 | string | 主机/网段/域名 |
| scanType | `-s` + 值（默认 S） | enum | S=SYN, T=Connect, A=ACK, U=UDP |
| ports | `-p` 值（逗号连接） | string[] | 端口范围 |
| topPorts | `--top-ports` 值 | int | 最常见 N 端口 |
| serviceDetection | `-sV`（布尔开关） | bool | 服务版本探测 |
| osDetection | `-O`（布尔开关） | bool | OS 探测（需原始套接字） |
| skipHostDiscovery | `-Pn`（布尔开关） | bool | 跳过主机发现 |
| noDnsResolution | `-n`（布尔开关） | bool | 不做 DNS 解析（默认 true） |
| fastMode | `-F`（布尔开关） | bool | 快速模式 |
| sequentialPorts | `-r`（布尔开关） | bool | 顺序扫描 |
| openOnly | `--open`（布尔开关） | bool | 只显示开放端口 |
| timingTemplate | `-T` 值 | enum 0-5 | 时序模板，授权测试建议 ≤3 |
| hostTimeout | `--host-timeout` 值 | string | 如 30m |
| maxRetries | `--max-retries` 值 | int | 重传上限 |
| outputFile | `-oN` 值 | path | 额外文本报告 |
| extraArgs | 逐字透传 | string[] | 未建模参数 |

输出：`-oJ -` 将 JSON 写到 stdout。**注意 nmap JSON 在 host 数组末尾有尾随逗号**，网关解析前须去除最后一个 `]` 前的逗号。

### serviceScan（confirm-stage，外部网络）
固定 `-sV --version-intensity 5`，参数为 scan 的子集（无 scanType，新增 versionIntensity 0-9），输出同 scan。

## 并发与独占资源
- **instanceMode: per-run**——每次运行独立 nmap 进程，天然并行
- **exclusiveResources: 无**
- 框架级无并行限制；但高并发扫描可能触发目标网络限流或 IDS，工作流应控制并发度和时序模板
- 原始套接字扫描（-sS/-O/-sU）需 Npcap 驱动；无驱动时退化为 -sT（TCP connect），仍可运行

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| nmap.exe | 主程序 | f2496b4588c96a17 |
| ncat.exe | netcat | a3071223a56a18c9 |
| nping.exe | 包探测 | cf13938876c5379d |

本体检测路径：`<local-tool-body-path>
完整哈希见 `recipes/windows.json`。

## 合规提醒
- 所有扫描必须在明确授权范围内（自有资产、授权评估、本地靶场）
- 扫描向目标网络发送探测数据包，属 external sideEffects，confirm-stage
- timingTemplate 授权测试建议 ≤3，避免造成拒绝服务效应
- extraArgs 透传参数同样受 external-boundary 约束，目标必须在边界声明内
