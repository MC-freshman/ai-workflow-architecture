# 软件怎么用：直接入口 与 经连接器调用（qoder 平台内）

一句话：**同一批软件有两条路，选哪条取决于你要不要留痕。** 终端里自己跑就是"直用"——快、没有门禁、也没有证据；要进工作流、要被审计、要能在另一台机器上按同一版本复现，就走"中介调用"，由 `_connector` 起、由平台留 request/response/产物三份记录。

## 一、直用（不经工作流，实测可用）

下表是 2026-09-25 在本平台**不经连接器**直接跑本体拿到的读数（`p6-direct-use.py`，读数落 `qoder/runtime/maintenance/20260923-3.2.0/P6/health-and-direct-use.json`）。本体的绝对安装路径只存在本平台配置里，不写进文档。

| 软件 | 直用入口 | 实测应答 |
|---|---|---|
| dirsearch | 用它自己那份解释器跑脚本本体，加 `--version` | `dirsearch v0.4.3`，退出码 0 |
| mysql-cli | 客户端本体加 `--version` | `Ver 8.0.39 for Win64`，退出码 0 |
| wireshark-cli | `tshark --version` | `TShark (Wireshark) 4.2.6`，退出码 0 |
| nmap | `nmap --version` | `Nmap version 7.95`，退出码 0 |
| veracrypt | 桌面程序 | 本体在位；**本轮没有启动窗口**（起 GUI 要按当次同意） |
| burp-suite | 桌面程序 / 它的 MCP 端点 | 本体在位；同上，未启动 |

要点：**直用不需要 agent、不需要 workflow、不需要 run**，也不产生任何锁或证据。你只是想拿个工具用，就这样用。

## 二、中介调用（经连接器，有门禁有痕迹）

同一个软件被工作流里的 `software-call` 阶段调用时，走的是连接器，顺序固定且**任何一步不过就在启动之前停住**：解析配方 → 快照是否冻结 → profile 天花板 → 主机/路径边界 → consent → 参数按 input schema 校验 → 幂等键 → 才启动本体。

留痕落在**本次 run 自己的目录**里：`evidence/software-calls/<n>/` 下放 `request.json`（含实际 argv、工作目录、用了哪种证明、本体摘要状态）、`response.json`、`connector.json`（上下文）、`artifacts.json`（这次调用写出了哪些文件、各自 sha256）。会话类走 `evidence/software-sessions/<n>/`。这些都是运行私有产物，只在本平台内，跨平台要靠带哈希的交接包，不直读别家 runtime。

### 一条绿行到底证明了什么

连接器的默认证明方式是 `snapshot-only`，意思是三件事：**配方声明了这个能力**、**它的能力快照已冻结**、**装在本地的本体与配方钉的摘要一致**。它**不**声称"本体自己把这个工具广播出来了"。只有原生 MCP 形态（stdio/HTTP）且释放件显式声明要问，才会真去问一次工具清单——那是那种服务端答得出的问题，CLI 本体从不被问。

所以看到"某软件可调用"之前先看两件事：`declaration` 是 `declared` 还是 `derived`，`attestation.mode` 是哪一种。

### 现状（同一份 health 读数）

| 软件 | 可经连接器派发 | 卡在哪 |
|---|---|---|
| dirsearch / mysql-cli / wireshark-cli | 是 | — |
| burp-suite | 否 | 被钉的那一份快照**未冻结**（新冻结好的 1.0.1 已发布，但共享指针仍未翻，避免无授权影响其它平台） |
| nmap | 否 | 快照未冻结，且配方里 `verify.files` 的摘要位数不对 ⇒ 本体"不可核验"；它声明的 `-oJ` 在 7.95 上并不存在（当初因此拒绝冻结） |
| veracrypt | 否 | 快照未冻结；且它没有声明自己该走哪种适配器，派生出来只会是命令行门面 |

三行"否"都是**如实登记**，不是被悄悄刷绿的。

## 三、两条路的边界（一句话版）

- **要结果就行** → 直用。
- **要能审计、要能复现、要进工作流或要给别人接手** → 中介调用；代价是它会在启动之前因为快照、profile、边界或 consent 拒你，而拒绝的原文会点名是哪一处。
- **需要人工点鼠标的场景**（GUI、挂载卷、Burp 里的手工操作）不会被伪装成自动化成功：会话要么答 `SESSION_READY`（平台真起起来了、pid 在），要么答 `INTERACTIVE_REQUIRED` 并告诉你去起什么、起来之后拿哪个 key 来回查。
