# 编程手工作流

版本路线和每次升级的实现范围见 [release-roadmap.md](release-roadmap.md)。阶段状态由
`scripts/stage_machine.py` 管理，不能只在对话中口头推进。

这是 `math-modeling-programmer` 的执行顺序。每一阶段都应保存产物并报告状态，不能在
上一阶段未通过时静默进入下一阶段。

九阶段是项目级治理闸门；实际比赛需求通常以一个个小任务到达，因此在当前阶段内部使用
任务清单执行：`INBOX -> SPECIFIED -> READY -> RUNNING -> REVIEW -> ACCEPTED`，失败任务
进入 `REWORK` 或 `BLOCKED`。任务清单采用 JSON，使用 `scripts/run_tasks.py` 批量运行，
使用 `scripts/review_task.py` 记录建模手审核结果。

## 0. INIT：项目初始化

确认题目文件、数据目录、语言和运行环境。建立 `data/raw`、`src`、`configs`、
`experiments`、`results`、`figures`、`reports`、`tasks`。记录 Python/Matlab 版本、依赖和
入口脚本。原始数据设置为只读或通过代码约束不覆盖。

任务清单中的每项任务至少声明 `task_id`、`kind`、`title`、`args`、`inputs`、`outputs`、
`dependencies` 和 `acceptance`。运行器按依赖拓扑排序，独立任务可继续执行；依赖失败的
任务自动标记为 `BLOCKED`。相同清单、输入哈希、代码哈希和模式会复用为 `CACHED`，不会
静默覆盖既有执行记录。

## 1. AUDIT：数据审计

运行 `scripts/audit_data.py` 或等价程序，输出数据字典和审计报告。至少检查：

- 文件格式、编码、表名和列名；
- 行列数、数据类型、缺失、重复和异常值；
- 主键、关联键、时间字段和坐标字段；
- 单位、量纲和数值范围；
- 原始文件之间的对应关系。

发现问题时先记录为 `DATA_ISSUE`，说明影响和处理规则，不直接删除数据。

## 2. SPEC：模型规格确认

从建模手接收 `templates/model_spec.yaml`，逐项确认目标函数、决策变量、参数、
约束、输出指标、假设和基线。未确认项标为 `UNCONFIRMED`，并暂停依赖该项的实现。

## 3. BASELINE：最小可运行基线

先实现一个简单、可解释、能在小样例上复算的基线。保存：

- 基线代码和配置；
- 小样例输入与期望输出；
- 基线指标和运行日志；
- 与主模型比较所需的统一指标定义。

## 4. SOLVE：主模型实现

将模型规格逐项映射到代码。算法、参数和数据预处理分离；避免把数值常量硬编码在
函数内部。复杂优化或仿真应支持小规模模式，便于调试和独立复算。

## 5. EXPERIMENT：实验矩阵

使用配置文件而不是手工改代码控制参数。每次运行生成唯一实验 ID，并记录：

```text
experiment_id, code_version, data_version, config, seed, repetitions,
runtime, status, output_files, notes
```

实验失败也要写日志。不得只保留“最好的一次”而丢弃其他结果。

## 6. VALIDATE：验证和风险收敛

至少执行三种互补验证：解析/量纲、极端情形、小规模穷举、基线比较、独立实现、
敏感性分析、重复模拟或区间估计。将每项记录为 `PASS`、`FAIL` 或 `NOT_RUN`，并说明
是否影响结论。

对随机算法报告重复次数、随机种子、中心量、波动范围和抽样单位；不要把密集相关点
包装成独立重复实验。

## 7. FIGURES：图表生成

绘图脚本只读取冻结或明确标记版本的结果文件。每张图先填写一句话结论，再决定图形
类型、比较对象和误差表达。优先导出 PDF/SVG，复杂栅格图另存 300 dpi 以上 PNG。
图表审查规则见 [../references/plotting-standard.md](../references/plotting-standard.md)。

## 8. FREEZE：结果冻结与交付

运行全流程，生成 `results/result_registry.csv` 和 `results/manifest.sha256`。冻结前核对：

1. 摘要、正文、表格和程序中的数字是否来自同一结果登记表；
2. 图表是否由当前代码生成；
3. 相对路径、随机种子和依赖是否完整；
4. 论文手是否收到方法、数字、误差、图表和限制；
5. 任务登记表中的论文候选任务是否已人工审核；
6. 交付包是否移除缓存、临时文件、个人路径和隐私数据。

冻结后若要改模型，创建新版本，不覆盖旧实验。

## 阶段状态命令

```text
python scripts/stage_machine.py status --project .
python scripts/stage_machine.py advance --project . --to AUDIT
python scripts/stage_machine.py block --project . --reason "缺少单位确认"
```

`advance` 只允许按顺序推进，并检查该阶段所需的产物；不能用参数绕过门槛。
