---
name: wfa
description: 以专家模式调用工作流。用法：/wfa <agent-id> [任务描述]（工作流由该专家的 tool-lock 决定，不可指定）
---
按固定协议以 agent 模式调用共享工作流（占位符 $ARGUMENTS 由平台替换为用户参数）：

1. 解析参数：第一词 = agent-id，其余 = 任务输入。专家清单见 `{{AGENT_REGISTRY}}`（只读）。**不得**传工作流 id——主工作流由该专家 `tool-lock.json` 内的 `runnerWorkflow`（或与 agent id 同名的工作流）解析，引擎不消费调用方指定的工作流。
2. 数模任务（agent 为 `math-modeling-programmer` 或用户明示）：先按 `{{MANUAL_PATH}}` 与用户确认档位（未写 = **草稿**）；本平台未声明的能力（如求解器链）按契约结构化拒绝，不得绕过门禁，所需环境按 BP-1 §1.6 三选一归属声明。
3. 其他专家：调用协议与红线以 `{{MANUAL_PATH}}` 为准；引擎与契约路径以 `{{CONFIG_PATH}}` 的 `runner` / `contracts` 字段为准（**不硬编码版本**；config 未落盘时本命令不可用，提示用户先完成本平台的一键接入配置）。prepare 时 `target: {"mode": "agent", "id": "<agent-id>", "version": "<显式版本或省略>"}`——省略版本时解析共享 current（换代跟随见协议文档）；runner 经 tool-lock 精确解析工作流版本，不得绕锁。
4. 流程与环境：同 /wf 第 3–4 条（请求文件落 `{{RUNTIME_TMP}}`、平台解释器、平台声明 shell、三个 UTF-8/字节码环境变量）。若该专家 workflow 声明了 `scenarios`，场景名是 prepare payload 的**顶层 `scenario` 字段**，不是 `parameters` 里的键；用户点名场景时传入，未点名用 `defaultScenario`，workflow 未声明时不得传。
5. 汇报与红线：同 /wf 第 5–6 条；失败只汇报证据路径。
