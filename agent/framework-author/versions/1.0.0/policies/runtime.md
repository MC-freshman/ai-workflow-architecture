# runtime

本平台（qoder）执行面事实，2026-09-25 本轮实测：

- runner 生产钉版 `wf-runner 0.10.1`（`qoder/bridge/qoder-config.json`），脚本面走 `kernel-sandbox`
  一档（`scriptEnvironmentRungs=[kernel-sandbox]`）；`software` 仓以第三根只读挂载。
- 共享仓只读绑定：jail 内 `/shared/tool`、`/shared/agent`、`/shared/software` 均 `errno 30 EROFS`。
  所以任何写入共享仓的动作必须发生在 jail 外的受控会话里，不得指望脚本阶段能写。
- 运行产物只写本平台 `runtime/`；不得直读别平台 `runtime/`，跨平台续跑走带 sha256 的交接包。
- 判据命令一律带 `-B` / `PYTHONDONTWRITEBYTECODE=1` / `-p no:cacheprovider`：本轮实测过，
  直接跑已发布件会让 CPython 把 `.pyc` 写进只读发布目录（BP-1 已发布只读、R11 生成缓存）。
- `windowProfile`（256k / 1m）在本平台**未实测**：客户端 bundle 有 `contextWindow` 与 `1000000`
  字面但零静态赋值，日志与本地存储无读数 ⇒ 记在 `qoder/bridge/capabilities.json` 的
  `unverified["profile:windowProfile"]` + `gapPlan`（25 分钟路径）。1m 是用户授权的规划档，不是实测上限。
