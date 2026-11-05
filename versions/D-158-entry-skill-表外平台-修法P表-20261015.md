# D-158 修法实施 P 表：entry-skill 槽位对表外平台降级而非硬抛

- 缺陷号：**D-158**（登记于 commit `1022eaec`，2026-10-15）
- 状态：**待采纳**（BP-5：无 P 表的方案只是议题，不构成实施授权）
- 缺陷一句话：`src/onboarding-entry-skills.mjs:42-46` 的 `entrySkillSlots` 只在硬编码 SLOTS 六平台里查表，表外 id 硬抛 `ENTRY_SKILL_SLOT_UNKNOWN`，经 `onboarding-client.mjs:38` 阻断一切新平台接入计划。
- 编制依据：2026-10-15 用户终端权威全量读数（`npm test` → tests 345 / pass 331 / **fail 12** / 217.9s）的 C 簇 5 红 + 调用面只读盘点。

---

## §0 范围护栏（P 表之内 / 之外，执行期不得即兴扩范围）

**做**：让表外平台走「无本地命令位」降级路径，与既有 doubao/dsh/qoder 同口径。

**不做（明写）**：

1. 不改 SLOTS 六项（codex / workbuddy / zcode / doubao / dsh / qoder）的任何现有行为；
2. 不改模板真身 `architecture-manager/src/runtime/entry-skills/{wf,wfa}/SKILL.md`；
3. **不替任何具体平台声明或新增技能位**——那是平台接入轮的事，本表只解决「别炸」；
4. 不动在途三件：`src/domains/platforms/native-client.mjs`（M）、`src/domains/platforms/native-client-session.mjs`（??）、`versions/anchor.json`（M）；
5. 不顺手改 `package.json` 的 test glob —— 那是 D-159，另案；
6. 不动 `inbox/archive/` 下 16 条 2026-10-13 遗留的未提交删除（非本轮产物，待用户裁决）。

---

## §1 P1 只读盘点（约 30 min）

| 子块 | 动作 | 判据 |
|---|---|---|
| 1.1 | 复核调用面：`collectEntrySkillFiles` 生产侧**唯一**调用点 = `src/onboarding-client.mjs:38`；`src/domains/intake/platform-body.mjs:51` 经 `buildOnboardingClientPlan` 复用；`renderEntrySkills`/`entrySkillSlots` 另只被 `test/entry-skills-onboarding.test.mjs` 使用 | 书面清单（含行号）与现字节逐条对应；**若发现清单外的新增调用点，停手回报** |
| 1.2 | 复核兜底路径已存在且被走通：`kind:'none'` → `collectEntrySkillFiles` 落 `<platform>/runtime/entry-skills-export/<skill>/SKILL.md`，`unplaced[].reason === 'NO_LOCAL_COMMAND_SLOT'`；doubao/dsh/qoder 现行走此路 | 三平台现有测试绿，产物路径与代码一致 |
| 1.3 | 复核 `resolvePython` 现有链路：`slot.config` 的 `interpreters['.py']` → `<id>/bridge.json` 的 `runner.python` → `PYTHON_UNRESOLVED`；确认新平台 config 命名（`<id>/bridge/<id>-config.json`，由 `buildOnboardingConfigPlan` 产出；codex/dsh 例外用 `runner-config.json`） | 两种命名都在探测顺序里 |
| 1.4 | 确认 `docs/entry-skill-locations.md` 是槽位布局唯一事实源，需同步增补「表外平台」行 | 文件第 3 行声明已确认 |

**子块结束态**：清单落盘，可安全停手。

---

## §2 P2 红（TDD，约 45 min）

在**未修字节上**先让用例红。落点：`test/entry-skills-onboarding.test.mjs`（新增）+ 邻域用例。

| 用例 | 内容 | 未修字节上的预期 |
|---|---|---|
| T1 | 表外 id（如 `brand-new-client`）调 `collectEntrySkillFiles` **不抛**；返回 `slotKind:'none'`，`unplaced[].reason === 'NO_LOCAL_COMMAND_SLOT'`，`files` 指向 `<id>/runtime/entry-skills-export/{wf,wfa}/SKILL.md` | 红，错误 = `ENTRY_SKILL_SLOT_UNKNOWN:brand-new-client` |
| T2 | 派生槽 python 解析：预置 `<id>/bridge/<id>-config.json` 含 `interpreters['.py']` ⇒ 渲染出非空 `PYTHON_EXE`，`issues` 不含 `PYTHON_UNRESOLVED`；回退到 `bridge.json runner.python` 同样成立 | 红（拿不到计划，或空 `PYTHON_EXE`） |
| T3 | 空 / `null` / 非法 platformId **仍 fail-closed** 抛 `ENTRY_SKILL_SLOT_UNKNOWN` | **绿**（现状即如此；此例是防改坏的护栏，不是待修项） |
| T4 | 真实链路：`buildOnboardingClientPlan` 对表外 id 能出计划 → `apply` 后产物落 staging → `PLAN_PAYLOAD_MISMATCH` 复核确定性（按 `plan.generatedAt` 重建的 payload 逐字节相同） | 红，错误 = `ENTRY_SKILL_SLOT_UNKNOWN` |

**判据**：T1/T2/T4 三红且红的成因就是 `ENTRY_SKILL_SLOT_UNKNOWN`，T3 保持绿。**任一红例的失败原因与此不符（说明机制理解有误）→ 停手回报，不进 P3。**

---

## §3 P3 修（约 60 min）

落点：`architecture-manager/src/onboarding-entry-skills.mjs`（收口单点）+ `docs/entry-skill-locations.md`。

| 子块 | 改动 |
|---|---|
| 3.1 | `entrySkillSlots(platformId)`：表内命中照旧；表外且 platformId 合法（口径对齐 `src/git.mjs:85` 的 `/^[a-z][a-z0-9-]{1,30}$/`）→ 返回 `{ config: null, manual: null, kind: 'none', dir: null, derived: true }`；**空/非法仍抛 `ENTRY_SKILL_SLOT_UNKNOWN`**（fail-closed 不减） |
| 3.2 | `resolvePython` 对派生槽按 `<id>/bridge/<id>-config.json` → `<id>/bridge/runner-config.json` → `<id>/bridge.json` 的 `runner.python` 顺序探测，逐条记 `source`；全缺仍回 `PYTHON_UNRESOLVED` 并保留 `issues` 记账（**不洗绿**） |
| 3.3 | `collectEntrySkillFiles` 的 summary 增 `derivedSlot: true`，便于 UI/台账区分「已知无槽位」与「未知平台」 |
| 3.4 | `docs/entry-skill-locations.md` 增「表外平台」行：按无本地命令位处理，走 staging 导出，登记为 BP-2 时间差（非永久缺口） |

**判据**：P2 的 T1/T2/T4 转绿 + T3 仍绿；`test/entry-skills-onboarding.test.mjs` 既有 3 例（workbuddy / doubao / zcode）**零回归**。

---

## §4 P4 回归（约 45 min）

| 子块 | 动作 | 判据 |
|---|---|---|
| 4.1 | 邻域子集：`node --test test/entry-skills-onboarding.test.mjs test/onboarding-client.test.mjs test/onboarding-evidence-regression.test.mjs test/platform-body.test.mjs test/onboarding-l1.test.mjs test/certification-scope.test.mjs test/certification-incremental.test.mjs test/module-boundaries.test.mjs` | 全绿；C 簇 5 红转绿 |
| 4.2 | `npx eslint src scripts` | 0 错 |
| 4.3 | 真机只读：对 `E:/ai` 调 `entrySkillSlots('a-new-client')` 确认降级不抛；调 `entrySkillSlots('workbuddy')` 确认表内返回值逐字段未变 | 两读都成立且可回读 |
| 4.4 | EOL 体检：目标文件改前改后各查一次行尾；`git diff --stat` 验无膨胀（裸 LF 文件必须字节级写） | diff 行数与改动行数同量级 |

**注**：全量 `npm test` 的权威读数只能在**用户终端**跑（agent 环境 spawn 类用例超时，不具参考性），判据以 4.1 邻域子集为准；全量留给用户。

---

## §5 P5 收口（约 30 min）

| 子块 | 动作 | 判据 |
|---|---|---|
| 5.1 | D-158 → `closed`，evidence 补「P2 红的具体错误原文 / P3 绿 / commit sha」；跑 `python versions/缺陷状态簿.check.py` | 输出 `ok: true`，D-158 离开 redRows |
| 5.2 | git 提交：**精确 stage** 仅 `src/onboarding-entry-skills.mjs`、测试文件、`docs/entry-skill-locations.md`、缺陷簿；不碰在途三件与 inbox 删除 | `git status` 中在途三件状态不变 |
| 5.3 | BP-6 四项读数：HEAD sha / 白名单内 status 空 / 远端与本地一致（不一致须如实报未推送）/ 入库时间早于任何破坏动作 | 四项齐备可回读 |

---

## §6 风险与明写代价

1. **已知取舍**：派生槽 `kind:'none'` 意味新平台**不自动获得本地 /wf /wfa 命令位**，只拿到 staging 导出供手工取用。这与 doubao/dsh/qoder 完全同口径（2026-10-14 既定兜底），按 BP-2 记为**时间差**而非永久缺口。
2. **不改 SLOTS 表本身** ⇒ 若将来第七平台需要真正的技能位（而非 staging），须另立一次登记 + 走 `--only` 单格冒烟（BP-3 最小量）。本表不含该项。
3. **PLAN_PAYLOAD_MISMATCH 敏感性**：`buildOnboardingClientPlan` 的 payload 含渲染字节，派生槽的 `derivedSlot` 字段一旦加入，旧计划与新计划的 payload 会不等 ⇒ T4 必须验证「同一 `generatedAt` 重建后逐字节相同」，否则会引入新的假漂移。
4. **不修的平台未知性**：本表不猜测任何平台的槽位布局；未实勘即声明槽位会违反「不谎报」。

---

## §7 完成判定

P1–P5 各按其预先写明的判据跑完 **即 = D-158 修复完成**。同一轮内不得追加验收项、不得提高判据门槛（BP-5）。加码的唯一合法时点是本表定稿之前。
