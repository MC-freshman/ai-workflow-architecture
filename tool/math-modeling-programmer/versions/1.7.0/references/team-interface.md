# 三人协作接口

## 建模手 -> 编程手

必须提供：目标、变量、参数、单位、约束、假设、输出指标、基线和待确认项。使用
`templates/model_spec.yaml`，不以聊天中的模糊描述作为唯一接口。

对于零散需求，补充任务卡字段：`task_id`、`kind`、`title`、`objective`、`inputs`、
`outputs`、`dependencies`、`acceptance`、`priority` 和 `paper_candidate`。多个任务应放入
同一份 JSON 清单，由 `scripts/run_tasks.py` 批量执行。

## 编程手 -> 论文手

必须提供：冻结结果、保留位数、误差或区间、参数来源、图表文件、生成脚本、方法摘要、
局限性和复现命令。使用 `templates/result_registry.csv` 统一数字来源。

任务层交接还应提供：`tasks/task_registry.csv`、任务审核状态、未完成任务及其阻塞原因。

## 冲突处理

题目原文和当年竞赛规定优先；其次是队伍确认的模型规格和真实运行结果；最后才是案例
经验。任何冲突都记录在 `reports/decision_log.md`。
