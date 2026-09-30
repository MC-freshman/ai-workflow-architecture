# 可复现工程规范

## 版本和路径

- 使用相对路径；集中管理输入、输出和配置。
- 记录解释器版本、关键依赖、操作系统和代码版本。
- 参数、随机种子和实验矩阵放入配置文件，不散落在源码中。

零散任务使用 JSON 清单管理。任务输入、代码版本、模式和参数共同形成任务指纹；相同
指纹可以复用为 `CACHED`，但每次复用仍写入任务登记表。

## 运行入口

提供一个从原始数据到结果和图表的主入口，支持小规模快速模式和正式模式：

```text
python run_all.py --config configs/official.json
```

失败时返回非零状态码并保留日志；成功时输出实验 ID 和产物清单。

任务批处理入口示例：

```text
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --mode quick
python scripts/run_tasks.py tasks/manifests/eda_q1.json --project . --mode official --no-cache
```

## 冻结

冻结包应包含源码、配置、README、结果登记表、图表生成脚本和 SHA-256 清单；不包含
缓存、临时文件、个人绝对路径、未使用数据和敏感信息。
