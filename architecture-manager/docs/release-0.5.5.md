# Architecture Manager 0.5.5 使用说明（快照必须与判据同版）

本版修的是 **0.5.4 暴露出来的另一半**。0.5.4 已经把判据改对了，但**快照没跟上**，于是失败点从"引擎拒绝"搬到了"合并拒绝"。

## 一、你在 0.5.4 上看到的现象

```
接入已停止在 certification：接入认证尚未通过 …（ONBOARDING_CHECK_FAILED）
conform-and-first-matrix
```

但矩阵**确实已经通过**：

```
matrix.json  summary = {"PASS":1,"FAIL":0,"NEEDS-INPUT":0,"EXPECTED":0}
rows         workflow:repo-lint@0.6.5  status=PASS  prepare/claimed/stopped 全 true
```

而 `check.json` 里写着：

```
stage  = check-failed
issues = 调用检查异常退出，报告未说明失败原因
commandErrors = 检查范围或来源回读不一致：CERTIFICATION_SELECTION_MISMATCH
```

## 二、为什么"通过"了还算失败

失败点已经不在引擎，而在**把这一次的结果并回首次认证证据**的那一步（`domains/certification/evidence.mjs`）。合并有一条硬校验：

> 矩阵返回的每一行，其**版本**必须等于**快照里该格的版本**。

- 0.5.4 改了**判据**：按平台声明判 → 返回行 `repo-lint@0.6.5` ✅
- 但**快照**（`domains/certification/fingerprints.mjs` 的 `certificationInventory`）仍旧读**共享指针** → 该格是 `0.6.3` ❌

两边不一致 ⇒ `CERTIFICATION_SELECTION_MISMATCH` ⇒ 合并失败 ⇒ 认证步失败。**这不是"格子没过"，是"两处对同一格的版本说法不同"。**

## 三、0.5.5 改了什么

让**版本解析只有一处**：

- `certificationInventory(root, platformId)` 现在也走**引擎那条优先级**（显式 > 平台 `bridge.json` 默认 > 共享 `current`）；未声明的格照旧用共享指针，行为不变。
- `certificationSnapshot` 调用时把平台 id 传进去（默认参数从 `certificationInventory(root)` 改为 `certificationInventory(root, id)`）。
- 于是**判据判的版本**与**快照描述的版本**由同一函数决定，合并校验必然成立。

**没有**改合并校验本身——它仍会拒绝"版本不符的行"，这条防线保留（新增测试专门证明它仍会拒）。

## 四、验收读数

| 项 | 读数 |
|---|---|
| 测试 | **208 通过 / 0 失败**（2 跳过），新增 `test/declared-snapshot.test.mjs` 2 条 |
| 关键断言 1 | 平台声明 `expert-task=2.0.0` 时，**快照该格版本 = 2.0.0**；未声明的格仍用共享指针 |
| 关键断言 2 | 声明版本改变后，**按声明版本判的行成功合并**；按旧版本判的行**仍被拒**（`CERTIFICATION_SELECTION_MISMATCH`） |
| 静态检查 | `eslint src scripts` 干净 |
| 真实工作区 | 未跑矩阵；仅只读实算（见 §五） |

## 五、你该怎么用

1. 装 **`Architecture-Manager-0.5.5-setup-x64.exe`**，**完全退出旧实例再打开**。
2. 平台与接入 → 向导 → 选 `dsh` → 第 5 步，点 **「核对当前更改后续接」**。
3. 期望（可回读，逐项看）：
   - `dsh/runtime/manager-check/<新时间戳>/matrix.json` → `repo-lint@0.6.5 status=PASS`，`summary.FAIL = 0`；
   - 同目录 `matrix.coverage.json` **出现**（合并成功的标志；0.5.4 那次没有这个文件）；
   - `check.json` → `stage` 不再是 `check-failed`，`issues` 为空；
   - 记录转 `verified-awaiting-governance-git`，第 6 步提交后显示"接入完成"。
4. 复算：`node scripts/verify-onboarding.mjs E:\ai dsh`。

## 六、这轮的教训（写下来免得再犯）

0.5.3 → 0.5.4 → 0.5.5 是同一条链上的三次修补，每次都在**上一个修复把问题推到下一站**之后才看清下一站：

1. **0.5.3**：判据不传 `--targets` ⇒ 引擎拒绝（`VERSION_CONFLICT`）。
2. **0.5.4**：判据按声明选了 ⇒ 但快照仍按共享指针 ⇒ **合并拒绝**（`CERTIFICATION_SELECTION_MISMATCH`）。
3. **0.5.5**：两处同源 ⇒ 一致。

根子在于**同一个"该用哪个版本"的决定散落在三处**（判据取版、快照建格、引擎解析）。本版把前两处收敛到同一个函数（`domains/certification/declared.mjs`），第三处本来就是引擎的权威。
