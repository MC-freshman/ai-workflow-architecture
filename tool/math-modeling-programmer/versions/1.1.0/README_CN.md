# math-modeling-programmer

面向数学建模竞赛编程手的 Skill 包。V1.1 将数据审计、模型实现、实验管理、验证、图表、
题型适配和受限 MCP 统一到一条可追溯流水线中。

## 快速使用

1. 使用 `scripts/init_project.py` 创建项目底座。
2. 按需读取 `references/` 中与当前阶段相关的规范。
3. 将 `templates/model_spec.yaml` 交给建模手填写，并改为 `status: CONFIRMED`。
4. 使用 `scripts/audit_data.py` 审计原始数据，使用 `stage_machine.py` 推进阶段。
5. 使用 `scripts/run_experiments.py` 和 `record_environment.py` 保存实验日志与环境。
6. 使用 `scripts/run_validations.py`、`check_lineage.py` 检查结果证据。
7. 使用 `register_figure.py`、`check_figures.py` 和 `check_pdf.py` 检查图表与 PDF。
8. 使用 `scripts/freeze_artifacts.py` 生成交付包哈希清单。

图表 QA：复制 `templates/figure_contract.json` 到项目配置，确保绘图模块提供
`build_figure()`，然后运行 `scripts/run_figure_qa.py`。它会生成 150 DPI 预览、文字包围盒
检查、最终 PDF 碰撞报告、实际 PDF 字号报告、碰撞诊断 overlay PDF 和多面板对齐报告。
最后使用 `scripts/record_visual_review.py`
逐项记录图例、标注、裁切、灰度和数据范围检查；视觉复核不可用时结果保持 `NOT_RUN`。

## 任务驱动执行

完整操作说明见 [TASK_WORKFLOW_USAGE.md](TASK_WORKFLOW_USAGE.md)。
建模手和论文手的交接规则见 [TEAM_HANDOFF_USAGE.md](TEAM_HANDOFF_USAGE.md)。

比赛中的零散需求（例如一批 EDA、一次模型比较或一张诊断图）放入 JSON 任务清单，
不需要为每项任务单独推进九阶段。初始化项目会创建 `tasks/` 目录和示例清单：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --mode quick
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --task EDA-Q1-001
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --status
python scripts/review_task.py --project . --task-id EDA-Q1-001 --decision ACCEPTED
```

每项任务声明输入、输出、依赖和验收条件。运行器会按依赖执行，独立任务继续运行，
依赖失败的任务标为 `BLOCKED`；相同输入、代码、参数和模式的结果会标为 `CACHED`。
完整执行记录在 `tasks/task_registry.jsonl`，表格版在 `tasks/task_registry.csv`。

## 示例命令

```text
python scripts/audit_data.py data/raw/input.csv --output-dir reports
python scripts/init_project.py . --project-id 2026B
python scripts/record_environment.py --project .
python scripts/run_experiments.py configs/experiment.json --project .
python scripts/run_validations.py configs/validation_config.json --project .
python scripts/validate_results.py results/result_registry.csv
python scripts/freeze_artifacts.py .
```

脚本默认只处理 CSV、TSV、JSON 和本地项目文件。Excel、Matlab、LaTeX、绘图和代码执行
可以由项目自身依赖或后续 MCP 工具接入；工具不可用时必须在报告中标明未执行的检查。

## 目录说明

- `workflow/`：九阶段编程工作流和阶段门槛；
- `agents/`：数据审计、求解实现、验证和可视化的专门角色；
- `references/`：按需读取的规范和 MCP 工具契约；
- `schemas/`：项目、实验和结果血缘的机器可读契约；
- `adapters/`：网络传播、几何覆盖、质量控制、光谱信号四类题型适配器；
- `evals/`：12 个行为评测场景和评分标准；
- `templates/`：模型规格、实验配置、结果登记表和验证报告模板；
- `scripts/`：不覆盖原始数据的本地辅助脚本。

## 设计边界

本包不替代建模手对题意和假设的确认，也不保证任何算法对新题自动适用。比赛规则和当年
题目原文优先于本包中的默认建议；最终数字必须来自实际运行并通过验证的代码。

## MCP

V1.1 提供项目受限的 stdio MCP Server：

```text
python scripts/mcp_server.py --project E:/path/to/project
```

它只暴露项目初始化、数据审计、实验、图表 QA、验证、PDF、血缘和冻结工具，不提供任意
命令执行。MCP 不可用时，全部能力仍可通过上述 CLI 使用。
