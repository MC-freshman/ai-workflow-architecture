# 从零搭建

这套架构把“资源”和“平台”分开：共享仓库只发布接口兼容的 Workflow/Agent；Codex、ZCode 或其他平台只需实现同一适配接口。

## 1. 运行参考闭环

```text
python scripts/validate.py
python reference/adapter.py invoke "/wf hello-world 写一句问候"
python reference/adapter.py invoke "/wfa reviewer 检查这句问候"
```

第二条命令直接解析 Workflow。第三条先解析 Agent，再严格读取 Agent 的 `tool-lock.json`，调用方不能替 Agent 改工作流版本。

## 2. 新增 Workflow

1. 建立 `tool/<id>/versions/1.0.0/`。
2. 写 `manifest.json` 与 `workflow.json`。
3. 为版本载荷生成 `SHA256SUMS`。
4. 写 `tool/<id>/current.json`。
5. 在 `tool/registry.json` 登记。

## 3. 新增 Agent

1. 建立 `agent/<id>/versions/1.0.0/`。
2. 写 `manifest.json`、`prompt.md` 和 `tool-lock.json`。
3. `tool-lock.json` 必须钉定准确 Workflow 版本。
4. 生成 `SHA256SUMS`，再登记并切换指针。

## 4. 接入平台

平台只需实现解析、选版、锁定、执行、门禁、记录与恢复；平台状态必须落在自己的 runtime 中。资源目录不得出现 Codex、ZCode 等平台专属字段。

## 5. 升级默认版本

永远新建版本目录，不覆盖旧版本。候选版本通过校验后，只原子更新对应 `current.json`。已经开始的运行继续使用自己的 `run-lock.json`，不会被默认切换影响。

```text
python scripts/switch_default.py wf <workflow-id> <new-version>
python scripts/switch_default.py wfa <agent-id> <new-version>
```
