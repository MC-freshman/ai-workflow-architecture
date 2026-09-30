# Wireshark CLI (tshark, editcap, mergecap)

## 概述
Wireshark 是网络协议分析器。本配方封装其 CLI 工具集，用于**离线**捕获文件分析与格式转换；Wireshark.exe GUI 与实时抓包（-i 网卡，需 Npcap 驱动）不在编排范围内。

## 版本
- 配方版本：1.0.0
- 上游版本：4.2.6（v4.2.6-0-g2acd1a854bab）
- 接入形态：cli-wrapper（per-run）

## 能力清单与 argv 映射

### version（auto，只读自检）
```
tshark.exe --version
```

### readCapture（auto，本地文件）
```
tshark.exe [-r <inputFile>] [-Y <displayFilter>] [-R <readFilter>]
           [-J <proto>] [-j <proto>] [-c <N>] [-V] [-x] [-2]
           [-T json|jsonraw|pdml|fields|tabs|text|ek]
           [-e <field> ...] [-E separator=,]
```
默认 `-T json` 输出包对象数组（stdout）。`-T fields` 时用 `fields` 数组（-e 重复）指定列。**不发起任何网络连接**，只读本地文件。

### filterCapture（auto，本地文件）
readCapture 的特化：`displayFilter` 必填，固定 `-T json`；可选 `-w` 将过滤后的包写入新文件。

### convertCapture（auto，本地文件）
```
editcap.exe [-A <start>] [-B <stop>] [-r] [-d | -D <win>]
            [-s <snaplen>] [-C <chop>] [-t <adj>]
            [-c <pkts/file> | -i <sec/file>] [-F <fmt>]
            <inputFile> <outputFile>
```
成功时 stdout 通常为空，以退出码 0 + outputFile 存在判定。inputFile/outputFile 为位置参数 0/1。

### mergeCapture（auto，本地文件）
```
mergecap.exe -w <outputFile> [-F <fmt>] [-s <len>] <inputFile1> <inputFile2> ...
```
inputFiles 为可重复位置参数（至少 2 个），按时间戳合并。

## 并发与独占资源
- **instanceMode: per-run**——每次运行独立进程，天然并行
- **exclusiveResources: 无**
- 框架级无并行限制；大文件分析受磁盘 IO 和内存约束
- 所有能力均为本地文件读写，network=none

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| tshark.exe | 读取/过滤/分析 | c0e4998ae62e1abe |
| editcap.exe | 编辑/转换/裁剪 | 308d39d3b59336b2 |
| mergecap.exe | 合并捕获 | 920fde18d268eeea |
| capinfos.exe | 捕获元信息 | b18878847f6b7942 |
| text2pcap.exe | hex 转 pcap | 673b3e0c16afcd46 |

本体检测路径：`<local-tool-body-path> 依赖同目录 DLL，须保持目录完整）。完整哈希见 `recipes/windows.json`。

## 数据处理与敏感信息
- 输入：pcap/pcapng 捕获文件（工作区路径）
- 输出：JSON/文本到 stdout，或过滤/转换后的 pcap 到工作区
- 捕获文件可能含凭据、令牌、个人数据；证据写出前应脱敏，原始文件不进共享仓库
- 功能自检（非 version）需要最小 pcap 夹具，由网关测试包用 `randpkt.exe` 生成，不属 readonly 自检

## 已知边界
- 不封装实时抓包（-i）、网卡列举、USBPcap 录制（需要驱动与交互）
- 解密类参数（-o 密钥文件）暂不建模，需要时经 extraArgs 透传并走 confirm-stage
