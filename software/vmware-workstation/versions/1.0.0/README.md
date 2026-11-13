# VMware Workstation MCP 1.0.0

零依赖的 stdio MCP 服务器，用 `vmrun` 控制本机 VMware Workstation：电源与状态、客户机内操作、克隆、主机网络端口转发。

- 运行时：Node.js >= 20（本机 24.18 实测），无 npm 依赖、无 `node_modules`
- 现场：VMware Workstation 17.5.2（build 23775571），`vmrun 1.17.0`
- 协议：MCP stdio，换行分隔 JSON-RPC，支持 `2024-11-05` / `2025-03-26` / `2025-06-18`
- 工具数：21；名称对齐上游 `vmware-mcp` 的 `vmrun_*` 命名

## 为什么不是直接包上游

调研到的三个实现：

| 项目 | 情况 | 结论 |
|---|---|---|
| `ZacharyZcR/vmware-mcp` | Python 3.10+，117 工具；20 个走 vmrest、54 个走 vmrun、43 个走 vmcli；仓库无 LICENSE 文件 | 本机 Workstation 17.5.2 不带 `vmcli.exe`；无 LICENSE 不能复制代码 |
| `yeahdongcn/vmware-fusion-mcp-server` | macOS Fusion 专用 | 不适用 |
| `2501-ai/vmware-mcp` | vSphere/vCenter/ESXi，走 govc | 不是本机 Workstation |

因此本发布件**只借鉴工具面命名，不复制上游代码**，用 Node 24 重写服务层，并且只依赖本机确实存在的 `vmrun`。

## 先决条件

1. 已安装 VMware Workstation（本机 `D:\VMwareVMware`）。
2. `vmrun.exe` 可用。默认按以下顺序探测，也可用 `VMWARE_VMRUN` / `VMRUN_PATH` 指定：
   - `D:\VMwareVMware\vmrun.exe`
   - `C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe`
   - `C:\Program Files\VMware\VMware Workstation\vmrun.exe`
   - `C:\Program Files (x86)\VMware\VMware VIX\vmrun.exe`
3. Node.js >= 20。
4. 客户机操作需要 guest 内已安装 VMware Tools，并提供 guest 账号。

## 启动

不需要 `npm install`：

```bash
node E:\ai\software\VMware\versions\1.0.0\src\server.mjs
```

Qoder / Claude 等 MCP 客户端的通用配置片段（字段名以客户端为准）：

```json
{
  "mcpServers": {
    "vmware": {
      "command": "node",
      "args": ["E:\\ai\\software\\VMware\\versions\\1.0.0\\src\\server.mjs"],
      "env": {
        "VMWARE_VMRUN": "D:\\VMwareVMware\\vmrun.exe",
        "VMWARE_VMX_ROOTS": "D:\\VMwareVMware",
        "VMWARE_WORKSPACE_ROOT": "E:\\ai\\qoder-cn\\workspaces"
      }
    }
  }
}
```

`VMWARE_VMX_ROOTS` 是安全边界，必须显式配置；服务器不会默认信任任意路径。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `VMWARE_VMRUN` / `VMRUN_PATH` | 否 | `vmrun.exe` 绝对路径；不设则按上面的候选顺序探测 |
| `VMWARE_VMX_ROOTS` | 是 | 允许操作的 VM 根目录，`;` 分隔；所有 `.vmx` 必须落在其中 |
| `VMWARE_WORKSPACE_ROOT` | 复制工具需要 | 主机侧文件读写的允许根目录 |
| `VMWARE_GUEST_USER` | guest 工具需要 | 客户机用户名 |
| `VMWARE_GUEST_PASSWORD` | guest 工具需要 | 客户机密码；与下一项二选一 |
| `VMWARE_GUEST_PASSWORD_FILE` | guest 工具需要 | 含密码的 0600 文件路径；优先于环境变量 |
| `VMWARE_HOST_TYPE` | 否 | 默认 `ws`；可选 `fusion` / `player` |
| `VMWARE_TIMEOUT_MS` | 否 | 普通 vmrun 调用超时，默认 60000 |
| `VMWARE_CLONE_TIMEOUT_MS` | 否 | 克隆超时，默认 600000 |
| `VMWARE_READ_ONLY` | 否 | `1` 时拒绝所有写入/电源/克隆/端口转发操作 |
| `VMWARE_MCP_DEBUG` | 否 | `1` 时把审计事件写到 stderr |
| `VMWARE_MCP_LOG` | 否 | 审计 JSONL 文件路径；不设则不落盘 |

## 工具

| 工具 | 作用 | 写操作 | 需要 confirm |
|---|---|---|---|
| `vmrun_list` | 列出运行中的 VM | 否 | 否 |
| `vmrun_inventory` | 扫描 `VMWARE_VMX_ROOTS` 并合并运行状态 | 否 | 否 |
| `vmrun_status` | 读取 `.vmx` 配置与运行状态 | 否 | 否 |
| `vmrun_start` | 启动 VM（`gui` / `nogui`） | 是 | 否 |
| `vmrun_stop` | 停止 VM（`soft` / `hard`） | 是 | `hard` 需要 |
| `vmrun_reset` | 重启 VM（`soft` / `hard`） | 是 | 总是 |
| `vmrun_suspend` | 挂起 VM（`soft` / `hard`） | 是 | `hard` 需要 |
| `vmrun_pause` | 暂停 VM | 是 | 否 |
| `vmrun_unpause` | 恢复暂停 | 是 | 否 |
| `vmrun_guest_ip` | 通过 VMware Tools 取 guest IP | 否 | 否 |
| `vmrun_run` | 在 guest 内运行程序 | 是 | 总是 |
| `vmrun_ps` | 列出 guest 进程 | 否 | 否 |
| `vmrun_kill` | 结束 guest 进程 | 是 | 总是 |
| `vmrun_file_exists` | 检查 guest 文件 | 否 | 否 |
| `vmrun_copy_to` | 主机 → guest 复制 | 是 | 总是 |
| `vmrun_copy_from` | guest → 主机复制 | 是 | 总是 |
| `vmrun_clone` | 克隆 VM（`full` / `linked`） | 是 | 总是 |
| `vmrun_host_networks` | 列出主机网络 | 否 | 否 |
| `vmrun_portforward_list` | 列出端口转发 | 否 | 否 |
| `vmrun_portforward_set` | 新增/更新端口转发 | 是 | 总是 |
| `vmrun_portforward_delete` | 删除端口转发 | 是 | 总是 |

`confirm` 是调用参数里的布尔值。缺失或为 `false` 时，服务器在 spawn `vmrun` **之前**返回 `CONFIRM_REQUIRED`。

`vmrun_inventory` 递归深度为 4、最多返回 500 个 `.vmx`；更深的目录请把 `VMWARE_VMX_ROOTS` 设得更具体。

## 安全模型

- **路径白名单**：`.vmx` 必须位于 `VMWARE_VMX_ROOTS` 内；复制工具的主机路径必须位于 `VMWARE_WORKSPACE_ROOT` 内。先用 `realpath` 解析再比较，防 `..` 与符号链接绕过。
- **无 shell**：所有命令用 `execFile` + argv 数组执行，不接受任意 argv 透传。
- **确认门禁**：硬关机、重启、杀进程、克隆、端口转发写操作、guest 文件复制都必须 `confirm: true`。
- **只读开关**：`VMWARE_READ_ONLY=1` 时所有写操作前置拒绝。
- **凭据**：guest 用户名/密码只从环境变量或密码文件读取，不写日志、不进证据、不出现在返回的 `argv` 里。
- **已知限制**：`vmrun` 只支持 `-gu` / `-gp` 命令行参数，因此 guest 密码会出现在**本机进程列表**中。请使用专用低权限 guest 账号，并接受这一上游限制；本服务器无法消除它。
- **stdout 纯净**：stdout 只写 MCP JSON-RPC；日志只走 stderr 或显式配置的日志文件。
- **vmrun 后端**：`vmrun` 依赖 Workstation 的后端进程。若调用报通信类错误，先启动 VMware Workstation（或 `vmware.exe -x <vmx>`）再重试。

## 测试与自检

```bash
cd E:\ai\software\VMware\versions\1.0.0

# 协议 + 策略/argv 渲染（不触碰真实 VM）
npm test

# 只读实测（需要本机 Workstation 与至少一个运行中的 VM）
set VMWARE_LIVE=1
npm run test:live

# 重新生成 manifest / snapshot / schemas
npm run schemas

# 重新生成 SHA256SUMS
npm run sums

# 校验 JSON、capability 引用与逐文件哈希
npm run selfcheck
```

`npm run schemas` / `npm run sums` 只用于新版本 staging。1.0.0 一旦发布即不可改写；后续变化请在新版本目录里生成，不要对已发布目录重跑。

本轮实测覆盖：

- `vmrun_list`、`vmrun_inventory`、`vmrun_status`、`vmrun_guest_ip`、`vmrun_host_networks`、`vmrun_portforward_list` 对运行中的 kali 成功
- `vmrun_stop mode=hard`、`vmrun_reset` 缺 `confirm` 时被拒
- 缺 guest 凭据时 `vmrun_run` 返回 `CREDENTIALS_REQUIRED`
- 克隆目标越界时返回 `PATH_DENIED`
- 端口转发缺 `confirm` 时被拒

**未实测**（按计划记 SKIP，不冒充通过）：

- 真实 guest 命令执行、进程查询/结束、guest 文件复制（未提供 guest 凭据）
- 真实克隆（未提供一次性目标）
- 真实端口转发写入
- 电源变更（会中断正在运行的 kali）

## 本版不包含

- 快照工具（`listSnapshots` / `snapshot` / `revertToSnapshot` / `deleteSnapshot`）
- `vmrest` REST API（20 个工具；需要常驻服务与主机凭据）
- `vmcli` 工具（43 个；Workstation 17.5.2 本机没有 `vmcli.exe`）
- 共享文件夹、设备连接、截图、键盘注入、VMware Tools 安装
- HTTP / SSE 传输；本版只有 stdio

这些都可以在后续版本按新目录追加，不回改 1.0.0。

## 目录

```
E:\ai\software\VMware\
  current.json                 # ai-software-pointer/v1 -> 1.0.0
  versions\1.0.0\
    manifest.json              # ai-software/v1
    capabilities.snapshot.json
    schemas\                   # 21 个工具的参数 schema + 通用输出 schema
    recipes\windows.json
    selftest\readonly.json
    src\server.mjs             # MCP 入口
    src\lib\                   # protocol/config/policy/vmrun/tools
    tests\                     # node:test，零依赖
    scripts\                   # 生成 manifest/schema/sums 与自检
    README.md
    SHA256SUMS
    SOURCE.json
```

## 版本与入库

- 1.0.0 已发布，目录只读，不改写。
- 后续变化发新版本目录（`1.1.0` 等），再切 `current.json`。
- VMware Workstation 本体不入仓；仓内只有配方与适配器源码，和 `software/_connector` 的先例一致。
- `software/registry.json` **本轮未改**（共享侧变更需单独授权）。待追加条目建议：

```json
{
  "id": "vmware-workstation",
  "current": "VMware/current.json",
  "enabled": true,
  "kind": "mcp-stdio",
  "invocable": false,
  "transports": []
}
```

注意：manifest 的 `id` 必须是 schema 允许的小写形式 `vmware-workstation`，而用户指定的目录名是 `VMware`。入 registry 前需要决定是否把目录名改为 `vmware-workstation` 以保持 id 与路径一致。

## 来源与许可

- 工具面参考：<https://github.com/ZacharyZcR/vmware-mcp>（未复制代码；该仓库无 LICENSE 文件）
- `vmrun` 命令参考：VMware Workstation 17 自带 usage 与 Broadcom 文档
- 本发布件为本仓原创适配器；上游 VMware Workstation 本体仍按其商业许可使用，未随本仓分发
