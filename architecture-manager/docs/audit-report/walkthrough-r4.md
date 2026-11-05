# 走查记录 R4：接入流水线 / onboarding×11 / 认证档（审计 P6）

- 审计人：QA 严过关 ｜ 基线 HEAD：40820c1f ｜ 日期：2026-10-10
- 方式：纯静态读码走查（无动态执行）。**覆盖深度声明**：全读 onboarding-state.mjs(171)、onboarding-resume.mjs(78)、onboarding-auto.mjs 关键段(120-200)、onboarding-recovery.mjs(55，P0 阶段已全读)；状态机抽查 global-update.mjs(365，grep 级)；native-client/certification 域依赖其在 R0–R3 与既有测试中的间接证据。

## 检查项与结论

| 检查项 | 结论 | 证据位置 |
|---|---|---|
| 单实例运行保证 | **PASS**：`active` Map（realpath 小写+platformId 键）+ `certifyPreamble` 同步段内完成 has 检查→set（无 await 间隙，无 TOCTOU）；`ONBOARDING_ALREADY_RUNNING` | onboarding-state.mjs:19-20,54-71 |
| 崩溃恢复显示 | **PASS**：`status==='running'` 且不在 active → 读时降级 'interrupted'（不假装在跑） | onboarding-state.mjs:28 |
| 续接漂移防线 | **PASS**：① resume 前置：config/versions/adapter/environmentBinding 四重 SHA 复用判定，config 变更且 running/interrupted → `ONBOARDING_RESUME_DRIFT`（:63-64）；② **每步执行后**重读 clientBinding 全等比对（:83）；③ 矩阵恢复材料必须 `own()` 于 platformId/runtime/manager-check 内 + SHA 断言 + 行键/摘要双向比对（onboarding-recovery.mjs:14-17,24-26，P0 阶段结论）；④ resume 预览对 journal.finalTargets 逐条过 validTarget 白名单 + SHA 格式，`assertResumePreview` 用 stableJson 全等防预览后变更 | onboarding-state.mjs、onboarding-recovery.mjs、onboarding-resume.mjs:42-61 |
| 证据复用真实性 | **PASS**：步骤级复用要求 evidencePath 存在且 SHA 相符（:78）；首次认证证据路径必须落在 manager-check 前缀内（大小写不敏感）+ 双文件 SHA + 汇总数字一致性（readFirstCertification :143-155）；旧格式迁移标记 migratedFromStoredStep 可追溯 | 同左 |
| 状态机转移完整性 | **PASS（抽查）**：global-update 每平台持久化状态（prepared→preparing-environment→activating→checking→pending/validated-awaiting-push/complete/no-change/restored/stopped/external-change/failed-restored），activating 失败走 restoreOwnedFiles(beforeFiles)，governance 哈希断言贯穿（GLOBAL_UPDATE_WORKSPACE_CHANGED/SHARED_CHANGED），恢复链冲突检查（RESTORE_CHAIN_CONFLICT），跨 planId 的 prepared 状态迁移为 no-change 并留 reusedFrom 溯源 | global-update.mjs:227-348 |
| 暂缓（deferral）语义 | **PASS**：白名单校验（ONBOARDING_DEFERRAL_INVALID）+ 依赖传播矩阵（environment→全链、software→certification、client→certification）+ 传播理由逐格落账（"用户本次选择暂缓" vs "依赖暂缓的 X"）；native 未验证显式 pending 不冒充完成 | onboarding-resume.mjs:24-32；onboarding-auto.mjs:149-168 |
| 完成登记防线 | **PASS**：markOnboardingRecorded 要求 verified-awaiting-governance-git（或显式 allowPending+configured-pending）+ 四重 SHA 未漂移 + `git status --porcelain -- <治理路径>` 干净 + `ls-files --error-unmatch` 确认路径已被跟踪（防"写了但没提交"假登记） | onboarding-state.mjs:157-170 |
| 能力证明门槛 | **PASS**：capabilities 步硬性要求 isolation-jail/prompt-stage-claim/peerDispatch/consent-denied 四项全 true（onboarding-auto.mjs:158）；认证步骤的 client 探针证据复用需五键全等+SHA（:171-175） | 同左 |

## 缺陷候选

| ID | 级别 | 位置 | 证据/复现条件 | 影响 | 建议 | 置信度 |
|---|---|---|---|---|---|---|
| D-017 | P3·线索 | `onboarding-state.mjs:160` | markOnboardingRecorded 直接 `execFileSync('git',...)` 绕过 process-scope（其余 git 读取走 runScopedProcess 白名单路由）——虽为只读三命令且不受取消影响，但与 R0 的进程纪律不一致，且无 windowsHide 一致性（有传 windowsHide） | 统一性/可取消性缺口（此处不需要取消，实际风险≈0） | 改走 gitRaw 保持单一路径 | 高 |
| D-018 | P3·线索 | `onboarding-state.mjs:65` | 复用判定 steps 只保留 `client-tool-loop` 的 passed 项；conform 矩阵证据复用依赖 readFirstCertification/recovery 两条独立路径——两条路径判据不同（前者看 evidencePath+SHA，后者看 matrix/conform 双文件），极端情况下同一次运行的复用判定可能一条通过一条不通过，产生"复用了矩阵但重跑 client loop"之类的混合执行 | 无正确性问题（每步独立验证），仅执行效率/可解释性 | 统一证据复用判据入口 | 中 |
| 观察 | — | `onboarding-auto.mjs:128-129` | configuration 步骤双基线校验（候选计划 versions 与 plan.target.versions 全等 + journal 首步 payload 全等）设计上防止"改配置后按旧计划续跑"——与 INTEGRATION_BASELINE_MISMATCH 语义一致 | 无 | — | — |

## 与覆盖率读数的互证
- `domains/platforms/global-update.mjs` 行覆盖 11.5%（覆盖率 Top1 缺口）：本轮静态走查确认其状态机/恢复/checkpoint 逻辑自洽，缺口根因为 EBUSY 使 python 探针类测试全灭（coverage-map-v2 §2），**不构成"代码未测=有缺陷"的证据**；列为复跑后优先补测对象。

## 档位结论
R4 未发现 P0/P1。onboarding 域的核心资产——"四重 SHA 绑定 + 每步后漂移重查 + 证据路径白名单 + 暂缓依赖传播 + 完成登记的 git 干净断言"——经逐行核对成立。2 个 P3 线索均为一致性/效率级。
