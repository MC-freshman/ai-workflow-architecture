# 在途收尾：native-client-session 源码合入与衍生物隔离（2026-10-16）

> 性质：用户指令「把在途未提交的 D-158/159/160 修复（native-client-session.mjs 新件零测试）弄完，npm test、GitHub 上传完全搞完」的执行收口。
> 依据：`versions/管理台测试充分性评估与补测P表-20261015.md`（P2.2 阻断项 / P5 收口）、`architecture-manager/docs/发布门禁.md`（环境敏感用例口径）。
> 缺陷簿：D-161 登记并 closed（见 `versions/缺陷状态簿.json`）。

## 1. 在途项的准确形状（勘察结论）

10-15 修复轮（4f3c6c69 / 57ad8215 / e7cd1e7d / 10c92bd4 / 9f164d66）已完成 P1 门禁转绿、P3 护栏与 0.8.8 版本 bump，D-156/158/159/160 在簿内均已 closed。真正未收尾的是三件：

| 在途件 | 状态（勘察时） | 问题 |
|---|---|---|
| `architecture-manager/src/domains/platforms/native-client-session.mjs` | 未跟踪（??） | e7cd1e7d 只合入了它的 7 条测试，源码一字未 add——克隆方 npm test 在 import 阶段即全红（机械证据：`git cat-file -e HEAD:…` fatal；测试文件在 HEAD 且第 17 行 import 该模块）。P表 §2.1 预判的「新件零测试合入，风险最高」以「测试合入、源码遗漏」的形态兑现 |
| `architecture-manager/src/domains/platforms/native-client.mjs` | 已修改未提交 | nativeClientStatus 的 transport 判据需认 `vendor-client-session-tool-trace`（与 CLI trace 通道同源） |
| `versions/anchor.json` | 已修改未提交 | platform-conformance 1.6.0 → 1.6.3（冻结目录盘上核实：SHA256SUMS + manifest + SOURCE.json 齐备） |

另有三个衍生物目录裸露在 git status（`Architecture Manager/` electron-builder 解包输出、`release-final/` 0.8.7 发行暂存、`runtime/` GUI 运行数据），均从未入仓，与 BP-7 隔离规则冲突。

## 2. 本轮动作

1. **源码合入**：native-client-session.mjs（9.4 KB）入索引，闭合 P2.2。src 内无生产 import（模块按设计待 Qoder 会话证明通道接线，测试头注释已声明 un-wired），本轮不代接线。
2. **transport 同源**：native-client.mjs:155 判据白名单扩为 `['vendor-cli-model-tool-trace','vendor-client-session-tool-trace']`。
3. **anchor 钉版**：1.6.3（workspace 声明的 capability-floor judge 当前指针）。
4. **衍生物隔离**：.gitignore 增补三条（`git check-ignore` 逐条回读命中）。
5. **缺陷簿**：D-161 登记并 closed；`python -B versions/缺陷状态簿.check.py` → `ok:true`（156 行 / closed 130 / redRows 10 条不变）。

## 3. 验证读数

| 项 | 读数 |
|---|---|
| eslint（两个改动源文件） | 0 错 |
| `node --test test/native-client-session.test.mjs` | 7/7 绿 |
| native 邻域六文件（binding / ai-probe / mcp / onboarding / native-auxiliary / probe-lock） | 23 例 22 绿；唯一红 = 发布门禁.md 列明的环境敏感用例（本树内 Python 连接器缺 jsonschema；真实终端绿） |
| 全量 `npm test`（agent 树，node v24.18.0，884.9s） | **348 例 / 340 过 / 6 败 / 2 skip**；6 败与发布门禁.md 列明的 6 条环境敏感用例**逐条同名**，零真实回归 |
| 敏感扫描（5 个待提交文件，inspectBytes） | 全 clean；无二进制、单文件最大 9.4 KB（BP-6 推送前扫描） |

**权威全绿读数（348/346 + 2 skip）只能在用户终端跑**——发布门禁.md 明载那 6 条在真实终端是绿的（2026-10-15 读数 9.4s–56.0s/条），agent 树内 spawn 受限不具参考性。复跑命令：`cd architecture-manager && npm test`（node ≥24）。

## 4. BP-6 四项读数

| 读数 | 值 |
|---|---|
| HEAD sha | 见收口提交（本文件与该提交同批入库） |
| 白名单内 `git status` | 精确 stage 7 个文件（1 新源码 + 2 改动 + .gitignore + anchor.json + 缺陷簿 + 本文件），其余工作树改动零带入 |
| 远端与本地一致 | `git push origin main` 成功后 `git rev-parse HEAD` = `origin/main`（禁强推，BP-6） |
| 入库时间早于破坏动作 | 本轮无任何破坏性动作（无删除、无强推、无历史改写） |

## 5. 遗留（明写，不伪报完成）

1. **0.8.8 rebuild 未执行**：9f164d66 只是版本 bump；发行 EXE 需单独发布轮授权（0.8.6 先例：本地冻结、签 signtool、未入 git）。`release-final/` 现内容仍是 0.8.7。
2. **P3/P4 剩余项未采纳**：renderer 命令层行为测试（P4.2，依赖渲染层脚手架决策）、default-command.mjs 源码级单测（P4.1）仍开放；P表整体仍为「待采纳」状态的部分按 BP-5 不自行实施。
3. **历史轮次卫生观察（非本轮引入）**：10-13 修复轮（`versions/管理台原生验证缺陷修复-20261013.md`）对 D-146/147/149/150 有实质修复与活体读数，但簿内四行仍为 open（D-152 为厂商侧缺陷挂账、D-157 为 10-15 新登记）。是否补 closed 留待单独轮次，不在本收尾范围。
4. **D-158 遗留口径不变**：表外平台拿派生槽（staging 导出），不自动获得本地 /wf /wfa 命令位——BP-2 时间差，非永久缺口。
