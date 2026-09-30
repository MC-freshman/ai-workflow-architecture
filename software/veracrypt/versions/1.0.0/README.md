# VeraCrypt Encryption

## 概述
VeraCrypt 是开源磁盘加密软件，用于加密卷的挂载、卸载与创建。本配方封装 1.26.7 便携版的**命令行接口**（GUI 不编排）。挂载/卸载/建卷是系统级操作，需管理员权限与内核驱动，全部 `confirm-call`。

## 版本
- 配方版本：1.0.0
- 上游版本：1.26.7
- 接入形态：cli-wrapper（**singleton**，requiredProfiles: administrator）
- 版本自检方式特殊：`VeraCrypt.exe /?` 弹 GUI 帮助窗口、不输出 stdout，因此 version 能力读 PE 文件版本资源（ProductVersion），**不启动进程**

## 能力清单与 argv 映射

### version（auto，只读自检）
读 `VeraCrypt.exe` PE 版本资源 → 1.26.7（invocation.kind = file-version）。

### mount（confirm-call，系统级）
```
VeraCrypt.exe /q /v <volumePath> /l <driveLetter> /p <password>
              [/k <keyfile;...>] [/m ro|rm] [/a] [/b]
```

| JSON 参数 | argv | 必填 | 说明 |
|---|---|---|---|
| volumePath | `/v` | 是 | 卷文件/分区 |
| driveLetter | `/l` | 是 | 挂载盘符（单字母） |
| passwordRef | `/p` | 是 | **密钥位引用名**，不接受明文 |
| keyfiles | `/k`（分号连接） | 否 | 密钥文件 |
| readOnly | `/m ro` | 否 | 只读挂载 |
| removable | `/m rm` | 否 | 可移动介质 |
| autoMount | `/a` | 否 | 收藏卷自动挂载 |
| backgroundCache | `/b` | 否 | 后台缓存密码 |

成功判定：退出码 0 且盘符存在（postCheck: drive-exists）。

### dismount（confirm-call，系统级）
```
VeraCrypt.exe /q /d [driveLetter] [/f]
```
不传盘符 = 卸载全部卷；`/f` 强制关闭占用句柄。幂等（重复卸载同一卷安全）。

### createVolume（confirm-call，系统级，不可逆）
```
"VeraCrypt Format.exe" /q /create <volumePath> /size <N[KMG]> /password <pwd>
                        [/encryption AES] [/hash SHA-512] [/filesystem exFAT]
                        [/keyfiles ...] [/volume-type file]
```
**会创建或覆盖目标文件**，逐次确认；大卷创建耗时可达数十分钟（timeout 1800s）。

## 并发与独占资源
- **instanceMode: singleton**——内核驱动与挂载表是系统级单例
- **exclusiveResources**: `veracrypt-driver`、`mounted-volumes`、`drive-letters`
- **whenBusy: queue**——挂载/卸载/建卷全部串行排队，禁止并发
- **不支持并行**：两个 run 同时挂载可能争用盘符或损坏卷状态，已在 manifest 机读声明

## 凭据处理（重要限制）
- 密码只接受平台密钥位**引用名**（passwordRef），不接受明文
- VeraCrypt `/q` 静默模式下密码经 argv 传递，会**短暂出现在进程命令行**中——这是 VeraCrypt 上游的已知限制，无法在网关侧完全消除
- 对敏感卷优先使用 keyfiles（`/k`）；网关在证据留证时必须脱敏 `/p`、`/password` 参数
- 禁止把密码写入 run-lock、证据、日志明文

## 本体验证（Windows）
| 文件 | 角色 | SHA256（前 16 位） |
|---|---|---|
| VeraCrypt.exe | 挂载/卸载 | aee0d6f335e4346c |
| VeraCrypt Format.exe | 建卷 | 7e48cebbfa68a0ed |
| veracrypt.sys | 内核驱动（完整性检查） | 见安装目录 |

本体检测路径：`<local-tool-body-path>

## 合规与安全
- mount/dismount/createVolume 全部 confirm-call，逐次确认
- createVolume 不可逆，确认凭证必须包含精确的 volumePath 与 size 摘要
- 挂载点访问受 filesystem:system 权限约束；只读分析场景默认 readOnly=true
