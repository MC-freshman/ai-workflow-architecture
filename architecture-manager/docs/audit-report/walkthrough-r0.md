# 走查记录 R0：进程 spawn / 凭据档（审计 P3）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f（ui-p5 冻结）｜ 日期：2026-10-10
- 方式：纯静态读码走查（沙箱 spawnSync EBUSY 限制，无动态执行）
- 覆盖文件：`infrastructure/process-scope.mjs`(34)、`core/owned-process.mjs`(19)、`domains/software/credentials.mjs`(41)、`runtime/`：job_controller.py(74)、windows_job.ps1(100)、credential_store.py(163)、matrix_driver.py(37)、restore_env.py(67)、provision.py(164)、peer_dispatcher.py(92)、software-launch.mjs(106，P1 阶段已审，此处并入结论)

## 检查项与结论

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| 子进程是否参数数组化（无 shell） | **PASS**：process-scope/owned-process/windows_job.ps1/job_controller.py 全链 `shell:false`；windows_job.ps1 注释明确"never interpolated PowerShell"，argv 经 C# `Quote()` 规范引用（标准反斜杠/引号算法，逐字核对无缺陷） | process-scope.mjs:28-33；windows_job.ps1 Quote() |
| Windows Job Object 所有权（孤儿进程防护） | **PASS**：CREATE_SUSPENDED(0x4)→AssignProcessToJobObject→NtResumeProcess/ResumeThread 的顺序正确；KILL_ON_JOB_CLOSE(0x2000)；控制器死亡即收割整树 | job_controller.py:33-41；windows_job.ps1 CreateProcess flags 0x08000004 |
| 取消通道 | **PASS**：双通道（cancelPath 文件 + 命名 EventWaitHandle），atomicGit 用一次性 flag 绕过取消（git add/commit/revert/branch/tag 白名单，注释说明 index/ref 写原子完成） | process-scope.mjs:16-22；windows_job.ps1:125/取消轮询 50ms |
| **凭据泄漏路径（本档核心红线）** | **PASS（未发现泄漏路径）**：① 值仅经 stdin 内存传递（credentials.mjs:35 input；job_controller stdin 转发）；② checkpoint 只存 plan（credentials.mjs:34 `containsCredentialValues:false`）；③ 回执 receipt 只存 planSha256+result+afterSha256（:36），result 无值回显（credential_store.py:153 输出仅 backup 路径/标志）；④ 审计 target=reference（credentials.mjs:37）；⑤ Python 异常只输出错误码，显式排除值/原生 stderr（credential_store.py:160-162）；⑥ `read` 值仅 stdout 供 native MCP provider 内存消费（credential_store.py:94-97 注释即此设计） | 全部列出 |
| DPAPI/凭据库用法 | **PASS**：CryptProtectData 带每-realm 熵（digest(root)+'/name'）；CredWriteW persist=2 LOCAL_MACHINE；值长度双校验（2560 字节）；set 前做真实恢复演练（写 probe 目标→读回→删除，finally 清理） | credential_store.py:27-45,124-146 |
| 主记录原子写 | **PASS**：tmp + os.replace（credential_store.py:150-152） | 同左 |
| 备份恢复路径校验 | **PASS**：restore_env.unpack 的 zip-slip 三重检查（绝对路径/../反斜杠）；软链 target 必须在 allowedSystemInterpreters 白名单；sealed 文件逐字节 SHA 复核 | restore_env.py:14-19,30-39 |
| 计划重放防篡改 | **PASS**：applyNativeCredential 用 stableJson 全等比对重放的 expected plan（credentials.mjs:32）；provider 字节哈希必须与发行版一致（:27） | 同左 |
| 输出上限 | **PASS（有界）**：owned-process 16MB 上限触发 cancel flag；windows_job.ps1 流式 CopyTo 不在 Node 侧积压 | owned-process.mjs:15-16 |

## 缺陷候选（本档无 P0/P1；以下全部为线索/P3）

| ID | 级别 | 位置 | 证据/复现条件 | 影响 | 建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-003 | P3·线索 | `infrastructure/process-scope.mjs:22` | atomicGit 取消 flag `atomic-<uuid>.flag` 写入 context.cwd（平台根目录）；控制器崩溃/被杀时 flag 无清理，随 set 次数累积 | 用户工作区残留垃圾文件（无功能影响） | 控制器正常退出时回收自身 flag；或放入平台 runtime/tmp | 中（代码路径确证，未动态复现） |
| D-004 | P3·线索 | `core/owned-process.mjs:15-16` | 16MB 上限只写 cancel flag，stdout/stderr 字符串仍持续拼接直到子进程实际退出 | 极端情况下（取消响应慢）内存瞬时增长超过 16MB 上限 | 触发上限时同时 `child.kill()`（controller 会在下一轮 50ms 轮询收割树） | 中 |
| D-005 | P3·线索 | `core/owned-process.mjs:18` + `runtime/job_controller.py:70`、`windows_job.ps1` 末尾 | 退出码语义冲突：子进程若真实以 124/125 退出，被父层无差别映射为 timedOut/cancelled（owned-process:18 `cancelled: exitCode===125, timedOut: exitCode===124`） | 极少数命令退出码恰好 124/125 时取消/超时状态误报；当前命令面（git/python 工具链）未用这些码 | 控制器改用带外标记（如 stdout 尾行 JSON）或在 specification 中约定保留码 | 中 |
| D-006 | P3·线索 | `runtime/job_controller.py:44-45` | 若子进程未消费 stdin 即退出，`process.stdin.write` 抛 BrokenPipeError 未捕获 → 控制器带 traceback 退出，父层只见非结构化失败 | 错误诊断体验降级；无安全影响 | try/except BrokenPipeError 视为子进程提前退出 | 高（逻辑确证） |
| D-007 | P3·线索 | `runtime/credential_store.py:126-134` | 每次 set 在 backupRoot 下新建 uuid 子目录（previous.json+credential.json+MANIFEST.json），无任何清理/上限 | 频繁换值场景磁盘缓慢累积（含加密旧值，无明文风险） | 保留最近 N 份或按 reference 收敛 | 高（代码路径确证） |
| D-008 | P3·线索 | `runtime/provision.py:150` | `json.loads(run(...).splitlines()[-1])`：注册恢复命令输出的最后一行假定必为 JSON；venv/pip 前缀警告会打破假设 | 恢复演练误报失败（保守方向，安全侧） | 结构化输出到文件再读 | 高（逻辑确证） |
| D-009 | P3·线索 | `runtime/peer_dispatcher.py:29` | `request_path = root / (body['requestId'] + '.json')`：requestId 未经本地格式校验即拼路径；依赖上游对 sequence/peer id 的 `^[a-z0-9][a-z0-9._-]*$` 校验 | 若上游校验被绕过，可在平台 runtime 内写越界文件（纵深防御缺口，非直达） | dispatcher 内复读一次 ID 白名单 | 中（依赖链未逐级验证） |
| D-010 | P3·线索 | `infrastructure/process-scope.mjs:16` | readonlyGit 白名单缺 `log`/`blame`/`worktree list` 等纯读子命令 → 配置了 python 的平台，这些命令也走完整控制器路径 | 仅性能开销（多一层 powershell/python 启动），无正确性问题 | 白名单补充纯读子命令 | 高 |

## 与在册缺陷的关联
- software-launch.mjs 的 `runtime/tmp/manager-launch` 残留（P1 方案线索 ⑤）在本档复核确认存在：response 证据文件按 planId 累积、崩溃时 `allowGuiLaunch:true` 一次性配置可能残留——**登记为本档新候选 D-011（P3·线索，建议归入平台 runtime/tmp 清扫策略统一处理）**。与 D-001/D-002 无关。
- matrix_driver.py：纯只读共享矩阵驱动，manifest 权限档校验 + jsonschema 验证后才注入 input，报告附加 managerDriver 指纹——未发现缺陷。

## 档位结论
R0 未发现 P0/P1。凭据红线（值不落计划/审计/日志）经全链路读码确认成立。9 个 P3 线索候选全部不阻塞发布，建议统一进入修复批次低优先级队列。
