# 任务驱动工作流使用说明

本说明面向编程手。它处理建模手逐项提出的 EDA、模型比较、参数扫描、重算和绘图需求。
九阶段流程负责项目级质量控制；本说明的任务层负责日常执行。

## 1. 初始化项目

建议每道赛题或训练题建立一个独立项目，不直接把题目附件放进工作流包目录。

```text
python <workflow-root>/scripts/init_project.py <project-root> --project-id 2026NMC_A
```

初始化后会生成：

```text
project-root/
├── data/raw/                 # 原始数据，只读
├── data/processed/           # 清洗和派生数据
├── scripts/                  # 任务运行脚本
├── experiments/tasks/        # 每项任务的日志和元数据
├── results/                  # 表格、指标和最终结果
├── figures/                  # 图表
├── reports/                  # 审计和验证报告
└── tasks/
    ├── inbox/                # 尚未整理的需求
    ├── manifests/            # 批量任务清单
    ├── accepted/             # 已审核任务说明
    ├── blocked/              # 阻塞任务说明
    ├── task_registry.jsonl   # 机器可读登记表
    └── task_registry.csv     # 可用 Excel 打开的登记表
```

## 2. 把需求写成任务卡

复制 `templates/task_manifest.json` 到项目的 `tasks/manifests/`，每项任务至少填写：

```json
{
  "task_id": "EDA-Q1-001",
  "parent_question": "Q1",
  "kind": "eda",
  "title": "数值字段分布摘要",
  "objective": "判断字段是否存在偏态和极端值",
  "args": ["--operation", "describe_numeric", "--column", "value"],
  "inputs": ["data/raw/orders.csv"],
  "outputs": ["results/eda/EDA-Q1-001/summary.json"],
  "dependencies": [],
  "acceptance": ["报告缺失值和分位数", "记录异常值规则"],
  "priority": "P1",
  "paper_candidate": false
}
```

`outputs` 是强约束：程序返回 0 但没有生成声明的文件，任务仍会被标记为 `FAIL`。
`dependencies` 只填写同一清单中的任务编号。任务编号建议使用 ASCII，例如
`EDA-Q1-001`，便于路径、日志和论文引用。

## 3. 批量执行

在项目根目录运行：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --mode quick
```

正式计算使用：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --mode official --no-cache
```

只运行某项任务时，运行器会自动带上它依赖的任务：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --task EDA-Q1-014
```

运行结果写入 `experiments/tasks/<task-id>/<run-id>/`，包括：

- `stdout.log`：标准输出；
- `stderr.log`：错误输出；
- `metadata.json`：输入哈希、代码哈希、运行模式、耗时和产物；
- `last_task_run.json`：本批次汇总。

## 4. 任务状态

查看每项任务的最新状态：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --status
```

常见状态：

| 状态 | 含义 |
|---|---|
| `PASS` | 程序成功且声明产物齐全 |
| `CACHED` | 输入、代码、参数和模式不变，复用既有结果 |
| `FAIL` | 程序失败、超时或缺少产物 |
| `BLOCKED` | 依赖任务失败或批次被停止 |
| `ACCEPTED` | 建模手已审核，可作为正式依据 |
| `REWORK` | 需要修改任务或重新计算 |

审核任务：

```text
python scripts/review_task.py --project . --task-id EDA-Q1-014 --decision ACCEPTED --notes "可用于论文"
```

## 5. 30 项 EDA 的推荐组织方式

先做一批快速探索任务，再筛选论文证据，不要一开始就为每项任务制作正式论文图。

```text
EDA-001~005  文件、字段、主键和单位审计
EDA-006~010  缺失、重复、异常值
EDA-011~015  单变量分布和分位数
EDA-016~020  相关性、分组差异和交互关系
EDA-021~025  时间、空间或网络结构
EDA-026~030  面向候选模型的诊断分析
```

快速批处理后，将真正支持模型假设或结论的任务设置为 `paper_candidate: true`，重新
以 `official` 模式运行并审核为 `ACCEPTED`。其余任务保留在审计结果中，不必全部放进论文。

## 6. 任务入口约定

任务清单的 `entrypoint` 指向一个通用任务程序。运行器通过环境变量传递上下文：

```text
TASK_ID            当前任务编号
TASK_RUN_ID        本次运行编号
TASK_KIND          任务类型，例如 eda、solver、figure
TASK_MODE          quick、official 或 debug
TASK_OUTPUT_DIR    本次任务的日志目录
TASK_INPUT_HASHES  输入文件哈希 JSON
```

通用程序根据 `TASK_ID` 或 `args` 选择具体操作，例如 `describe_numeric`、
`check_missing`、`group_compare` 或 `plot_distribution`。分析逻辑应放在可复用函数中，
不要把 30 项任务复制成 30 个脚本。

## 7. 交接和冻结

论文手只使用：

1. `tasks/task_registry.csv` 中审核为 `ACCEPTED` 的任务；
2. `results/result_registry.csv` 中的关键数字；
3. 已登记来源结果 ID 的图表；
4. 验证报告和限制说明。

冻结前运行项目级检查：

```text
python scripts/project_doctor.py .
python scripts/validate_results.py results/result_registry.csv
python scripts/check_lineage.py --project .
python scripts/check_figures.py --project .
python scripts/freeze_artifacts.py .
```

冻结后修改模型，应创建新的实验或版本，不覆盖已交付结果。

## 8. 常见问题

- 任务显示 `FAIL`：先看对应任务目录中的 `stderr.log`，再检查声明的输出路径。
- 任务显示 `BLOCKED`：先修复依赖任务，再重跑依赖链。
- 结果显示 `CACHED`：使用 `--no-cache` 强制重新计算。
- 论文数字找不到来源：检查任务是否 `ACCEPTED`，以及关键数字是否登记到结果表。
- Excel 无法直接审计：先使用统一的 Excel 转换程序生成处理数据，并保留原文件哈希和转换记录。
