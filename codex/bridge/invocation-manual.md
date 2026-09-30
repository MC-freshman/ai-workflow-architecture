# Codex `$wf`、`$wfa` 与兼容消息入口说明

> 适用架构：`E:\ai\versions\架构3.0.0.md`。本文件只描述 Codex 平台实现；共享接口与并发权威口径仍以 `E:\ai\invocation-adapters-spec.md` §8–§10 为准。

## 1. 接入边界

Codex 只读 `E:\ai\tool`、`E:\ai\agent` 与 `E:\ai\software`，运行记录只写 `E:\ai\codex\runtime`。本平台显式选择 `wf-runner 0.9.0`、`runtime-contracts 1.3.0`、`repo-lint 0.4.0` 与 `software/_gateway 1.0.0`；共享 `current.json` 不因 Codex 接入而变化。

架构层只提供 Workflow / Agent 两类稳定接口，不假定平台一定能兑现资源要求。Codex 为它们提供两个显式 Skill：

```text
$wf  <workflow-id>[@version] [task]
$wfa <agent-id>[@version]    [task]
```

`$wf` 与 `$wfa` 会显示为 Codex 本地 Skill，并分别附带桌面 UI 元数据。原有 `/wf`、`/wfa` 保留为由 `workflow-hub` 解释的兼容消息前缀，不冒充官方未提供的自定义原生斜杠菜单项。四种写法最终都进入 `ai_shared` MCP，底层统一使用 `ai-run-protocol/v1.1`、`v1.2`、`v1.3`。

## 2. 统一输入格式

两种入口最终都规范成：

```json
{
  "parameters": {},
  "inputSources": [
    {
      "sourcePath": "E:\\ai\\codex\\workspaces\\...\\input.ext",
      "snapshotPath": "inputs/project/input.ext"
    }
  ]
}
```

- `parameters` 必须符合目标工作流的 `inputSchema`。
- `inputSources` 只允许平台配置 `inputRoots` 内的来源；runner 在 prepare 时复制并哈希，之后只使用 run 内快照。
- `/wfa` 只接受 Agent id、可选 Agent 版本和任务输入。主工作流由 Agent manifest 的 `runnerWorkflow` 与精确 `tool-lock` 决定，调用方不能覆盖。
- 两种入口生成相同的 `ai-run-lock/v1.1`/`v1.2`/`v1.3` 兼容锁、`ai-run-state/v1.1`、事件、证据和门禁格式。

## 3. `$wf`（兼容 `/wf`）逐步执行

1. 解析 `<workflow-id>`；若写成 `id@version`，只对本次 run 显式钉版。
2. 调用 `ai_get_workflow_release`，确认资源已启用、manifest 可读、`SHA256SUMS` 全部通过。
3. 按工作流输入 schema 将自然语言任务映射为 `parameters`；用户文件映射为 `inputSources`。缺必填字段时停下询问，不编造。
4. 调用 `ai_run_workflow`。未给显式版本时依次使用 Codex 本地 `defaults.workflowVersions[id]`、共享 `current.json`。
5. 保存返回的 run id；prepare 已在 `E:\ai\codex\runtime\runs\<run-id>` 写入运行锁。
6. 用 `ai_runner_request(next)` 认领一步。返回 task 必须包含 `stageId / attempt / action / inputSha256 / artifacts / allowedTools`。
7. `prompt` 由当前会话完成；`script` 只能用 runner 已认领并允许的执行工具。输出先写 run 工作区，再按契约密封。
8. 用 `ai_runner_seal` 固定输出和门禁证据，然后用 `ai_runner_request(submit)` 提交；每次变更带上一步 `stateRevision`。
9. 重复 6–8，直到 `succeeded`。若失败、停止或缺信息，保留证据并如实汇报。

## 4. `$wfa`（兼容 `/wfa`）逐步执行

1. 解析 `<agent-id>` 与可选 `@version`，不得解析或接收调用方工作流 id。
2. 调用 `ai_get_agent_release`，验证 Agent 发布包与 `tool-lock`。
3. runner 从 Agent 的 `runnerWorkflow`（或同名且被锁定的唯一主工作流）选择主流程，并按 tool-lock 精确解析所有 workflow、skill、pack。
4. 将任务整理为该主工作流的统一输入格式，调用 `ai_run_agent`。
5. 后续与 `/wf` 完全相同：`next → 执行 → seal → submit`，共享相同状态机和证据格式。

## 5. 一句话切 Codex 默认

用户可以说：“`<id>` 已更新到 `<version>`，请将默认 tool/agent 设置为新版本。”

Codex 执行：

1. 判定 `kind=workflow|agent`、id 和精确语义版本。
2. `ai_set_platform_default` 校验注册表、manifest 和发布包逐文件 SHA256。
3. 原子修改 `E:\ai\codex\bridge\bridge.json` 中对应的 `defaults.workflowVersions` 或 `defaults.agentVersions`。
4. 在 `E:\ai\codex\runtime\default-switches` 写入带配置前后哈希的审计回执。
5. 回读配置并报告版本、作用域和回执路径。

该动作只改变未来 Codex run 的默认解析；不改共享 `current.json`、不改发布目录、不改其他平台，也不影响已创建 run。多个默认切换属于控制面操作，必须串行。

## 6. 独立性与并发

| 场景 | 结论 | 原因/处理 |
|---|---|---|
| 相同工作流、不同 run | 可并行 | 每个 run 独占目录、状态、事件与租约 |
| 不同工作流、不同 run | 可并行 | 共享发布包只读，产物各自落 run 根 |
| 不同 Agent、不同 run | 可并行 | 每个 Agent 独立解析自己的精确 tool-lock |
| 同一 run 同时认领/写入 | 不可并行 | 单 activeAttempt；版本/租约冲突必须拒绝 |
| 单 run 多阶段 | 不可并行 | `maxParallel=1`，保证证据链顺序一致 |
| 父 run 与被委派子 run | 父等待子 | Codex 当前未声明 peerDispatch，不具备时必须拒绝 |
| 共用脚本环境的脚本步骤 | 建议串行 | 避免环境级非线程安全状态相互干扰 |
| 两个数学 run 写同一用户项目 | 不可并行 | 项目目录是共享可变资源；须使用项目级串行 |
| 默认版本切换 | 串行 | 控制面原子写；在途 run 已锁定，不受影响 |

## 7. 3.0 平台边界与例外

1. `wf-runner`：接口可识别，但不会执行业务 run。它就是引擎，自调用会成环，返回 `CAPABILITY_UNAVAILABLE` 属设计结果。
2. `repo-lint`：接口和三根共享只读绑定已接线，但完整 live 扫描受到环境校验预算约束；超时或中止必须按协议停止，不得伪报成功。
3. 软件调用：六个配方 inventory 可读，但当前快照均为 `frozen:false`，因此网关在 `snapshot` 门拒绝，绝不进入 dispatch。

除上述登记项外，工作流与 Agent 仍以平台矩阵 `prepare → next → stop` 的 `FAIL 0` 为接入判据。

## 8. Codex 界面发现规则

- 在输入框键入 `$`，选择 `WF — Run Workflow` 或 `WFA — Run Agent`；实际显式名称分别为 `$wf`、`$wfa`。
- Skill 新增或更新后通常会被自动发现；若下拉列表未刷新，完全退出并重启 Codex。
- 在输入框键入 `/` 时不会看到 `wf` 或 `wfa`，因为 `/` 菜单只属于 Codex 原生命令。本架构不通过修改底层应用伪造原生命令。
- 即使不点选 Skill，也可直接发 `/wf ...`、`/wfa ...` 或自然语言，由兼容路由识别。

## 9. 故障与恢复

- 未创建 run：修正输入后重新 prepare。
- 已创建 run：按 `status` 与 `stateRevision` 恢复，不重读默认版本覆盖 run-lock。
- 未知副作用：不要自动重放；先读取事务回执与事件。
- 接入回滚：使用 `E:\ai\codex\runtime\runs\20260915-codex-architecture-100\backups` 恢复 Codex bridge 文件，再重启 `ai_shared`；共享仓库无需回滚，因为本次没有改动。
