# 走查记录 R5+R6：治理写文件域 + 渲染层注入面（审计 P7）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f ｜ 日期：2026-10-10
- 方式：纯静态读码走查（无动态执行）
- 覆盖文件：R5=`documents.mjs`(77)、`releases.mjs`(171)、`plans.mjs`/`catalog.mjs`/`runs.mjs`/`audit.mjs`（经 transactions.mjs applyDocument/applyPointer/applyRegistry 与既有测试的间接全链证据 + 抽查）；R6=渲染层注入面 grep（P5 已做）+ `ui:confirm` 复核

## 检查项与结论

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| 文档写入域 | **PASS**：路径白名单（versions/、docs-site/docs/、6 个顶层文件，仅 .md）+ baseline SHA 前置比对 + 顶层文件二次显式确认（TOP_LEVEL_CONFIRMATION_REQUIRED）+ apply 侧 checkpoint/SHA 复核/回滚（transactions.mjs:150-187，R1 已核） | documents.mjs:9-19,50-77 |
| 发布域（releases） | **PASS**：destination 格式硬锁；发布前对内存候选做 validateResourceContent（先验证后落盘）；每文件 safeRelative+targetPath 双查；写后 validateFrozenResource；幂等 already-applied 需 sums 全等；回滚 removeOwnedDirectory 按期望哈希（含 copyFrom 二进制） | releases.mjs:51-105 |
| 引用扫描 | **PASS（只读）**：仅文本后缀、拒绝含 NUL 文件、50 条截断、resourceId 仅作文本 needle 不进路径 | releases.mjs:136-171 |
| defect-book/registry/integration 写域 | **PASS**：transactions.mjs 中 applyDefectBook（目标硬锁 `versions/缺陷状态簿.json`）、applyRegistry（目标仅 agent|tool/registry.json + buildRegistryPlan 重放验证 + validateRegistry 语义验证）、applyIntegration（R1 多文件推演已核）——三域均走统一 SHA 基线/checkpoint/回滚/审计范式 | transactions.mjs:120-219,263-323 |
| 渲染层注入面 | **PASS**：`dangerouslySetInnerHTML/innerHTML/document.write/eval/new Function/window.open/href=` 全 renderer grep **0 命中**（React 默认转义）；`ui:confirm` 将 message 经 String() 传入**原生系统对话框**（非 HTML 渲染面），无注入路径；无 shell.openExternal（仅 openPath 本机目录） | grep 实测；main.mjs:143-146,228 |
| D-001/D-002 关联复核 | **确认在册，不重复登记**：presenter.mjs:66-69 重复键文案覆盖（D-001，P2）与 :194,205 同文本重复键（D-002，P3）为本档唯一渲染层确认缺陷，根因是手写大字面量映射表无防重护栏——D2 建议清单第 7 条（映射表防重回归用例）即为此设计 | presenter.mjs；coverage-map-v2 §4 |

## 缺陷候选

| ID | 级别 | 位置 | 证据/复现条件 | 影响 | 建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-019 | P3·线索 | `releases.mjs:113` | verifyRelease 用 `join(root, plan.target.destination)` 直接拼路径，**未经 targetPath 归一**（同文件内其余 verify* 及 verifyPlanTarget 的 document/registry 分支均用 targetPath）；verifyPlanTarget 对 release-publish 分支无 requirePlan 前置 | 恶意 plan 的 destination 含 `../` 时 verify 可读取工作区外目录并返回校验结果/错误串——**只读操作、返回布尔+路径串**，无写入面；且 plan 需先经渲染层确认流 | 改用 targetPath 并在 verifyPlanTarget 的 release 分支加 requirePlan | 高（不一致确证）/低（危害有限） |
| 观察 | — | `documents.mjs:24-27` | documentKind 以中文关键词（"实施表/方案/台账"）子串分类——仅影响展示分类 | 无 | — | — |

## 档位结论
R5/R6 未发现 P0/P1。治理写文件域统一范式（SHA 基线→checkpoint→原子写→读回验证→按哈希回滚）在全部 6 个写域一致成立；渲染层零注入汇使 D-016（CSP 缺失）维持 P3 加固定位。
