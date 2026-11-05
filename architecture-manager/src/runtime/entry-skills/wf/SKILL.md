---
name: wf
description: 调用 {{WORKSPACE_ROOT}} 共享工作流。用法：/wf <workflow-id> [任务描述或目标路径]
---
按固定协议调用共享工作流（占位符 $ARGUMENTS 由平台替换为用户参数）：

1. 解析参数：第一个词 = workflow-id；其余 = 任务输入。工作流清单见 `{{TOOL_REGISTRY}}`（只读）。
2. 调用协议与红线以 `{{MANUAL_PATH}}` 为准；引擎与契约路径以 `{{CONFIG_PATH}}` 的 `runner` / `contracts` 字段为准（**不硬编码版本**；config 未落盘时本命令不可用，提示用户先完成本平台的一键接入配置）。
3. 流程：组织符合该工作流 inputSchema 的 parameters → 写请求文件到 `{{RUNTIME_TMP}}` → 用 `{{PYTHON_EXE}} -B` 执行 `<config.runner>\cli.py --config {{CONFIG_PATH}} --request <请求文件>` → 按 state 推进 next/submit 直到 succeeded 或失败。选版顺序固定 **显式 > 本平台覆盖（`bridge.json` 的 `defaults.workflowVersions`）> 共享 current**，解析来源随 run 钉入 run-lock。
4. 环境：命令走本平台声明的 shell（config 未声明则 PowerShell）；执行前设 `PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`PYTHONDONTWRITEBYTECODE=1`。
5. 汇报：run-id、状态、output 路径、门禁结果、run-lock 位置（`{{RUNS_ROOT}}\<run-id>\`）。
6. 红线：禁止绕过 runner 改写 tool/agent/software 三仓；失败只汇报证据，不就地补救；不同 run 可并行、同一 run 不可并发写；未写档位 = **草稿**（数模与其它工作流同口径，所需环境按 BP-1 §1.6 三选一归属声明）；本平台未声明的能力按契约结构化拒绝，不绕过门禁。
