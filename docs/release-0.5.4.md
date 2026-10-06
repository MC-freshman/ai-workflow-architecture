# Architecture Manager 0.5.4 使用说明（判据按平台声明选格）

本版只做**一件事**，但它是 0.5.3 那一格一直失败的真正原因。

## 一、修的是什么

**症状**：接入认证永远停在

```
接入已停止在 certification：接入认证尚未通过 …（ONBOARDING_CHECK_FAILED）
conform-and-first-matrix
```

矩阵报告里 51 格通过、**1 格失败**，失败行恒为：

```
kind=workflow id=repo-lint version=0.6.3 status=FAIL
errorCode : VERSION_CONFLICT
errorMsg  : Selected workflow:repo-lint@0.6.3 conflicts with this platform's
            scannerRelease repo-lint@0.6.5; align the pin or request 0.6.5
```

**根因**：判据（`invocation_matrix.py`）按**共享 `current` 指针**取版（`tool/repo-lint/current.json` = 0.6.3），并把它当**显式版本**发进请求；而引擎的闸门是"选中版本必须等于本平台声明的 `scannerRelease`"（dsh = 0.6.5）。0.6.3 ≠ 0.6.5 ⇒ `VERSION_CONFLICT` ⇒ 该格 FAIL ⇒ 认证步失败。

**为什么点"继续"永远不变**：失败后管理台只补跑这一格（`pendingMatrixRecovery.only`），续跑走同一条参数拼装，**依旧不告诉判据该用哪个版本**，于是再按共享指针取 0.6.3，撞同一个闸门。**这是死循环，不是"再跑一次就好"。**

## 二、改了什么

管理台拼判据命令行时，**把平台自己声明的版本作为 `--targets` 传下去**：

- 新增 `src/domains/certification/declared.mjs`：按引擎同一条优先级读版本 —— **显式 > 平台 `bridge.json` 默认 > 共享 `current`**；声明值可以是裸版本（`0.6.5`）也可以是释放路径（`…/versions/0.6.5`）。
- `src/platform-check.mjs` 的参数拼装抽成纯函数 `buildMatrixArgs(...)`，其中对**平台声明过的格**追加 `--targets kind:id@version`；没声明的格一概不动（继续用共享默认）。
- `--only`、`--exceptions`、`--progress-jsonl` 等原有参数语义不变。

> `--targets` 不是新机制：单格冒烟（`domains/intake/smoke.mjs`）一直在用它。本版只是让**认证路径**也用上。

## 三、在真实工作区上的预期效果（只读实算，未跑矩阵）

| 平台 | 声明的 repo-lint | 该格判据命令将带 |
|---|---|---|
| dsh | 0.6.5 | `--targets workflow:repo-lint@0.6.5` |
| codex / zcode / qoder | 0.6.3 | `--targets workflow:repo-lint@0.6.3` |
| workbuddy | 0.5.2 | `--targets workflow:repo-lint@0.5.2` |
| doubao | （不声明） | 不带 `--targets`，维持共享默认 |

**每个平台按自己的配对受判，谁也不用迁就谁**；没有动共享指针，也没有改任何平台的配置。已核对：上表每个声明版本在盘上都存在且带 `SHA256SUMS`。

## 四、验收读数

| 项 | 读数 |
|---|---|
| 测试 | **206 通过 / 0 失败**（2 跳过），新增 `test/declared.test.mjs` 4 条 |
| 静态检查 | `eslint src scripts` 干净 |
| 关键断言 | 判据命令行**确实带** `--targets workflow:repo-lint@0.6.5`（dsh 形状）；未声明的格**不带** |
| 真实工作区只读实算 | 上表六行逐行如上 |

## 五、你该怎么用

1. 装本版（**`Architecture-Manager-0.5.4-setup-x64.exe`**），**完全退出旧实例再打开**。
2. 平台与接入 → 接入向导 → 选 `dsh` → 第 5 步「检查与接入」。
3. 点 **「核对当前更改后续接」**（不是"预览一键接入／继续"）：它会接纳当前状态、只重验受影响步骤，并清掉记录里那条陈旧的 `pending: 软件绑定`。
4. 期望读数（可回读）：
   - 新目录 `dsh/runtime/manager-check/<新时间戳>/matrix.json` 中 `repo-lint` 行 → `version: 0.6.5`、`status: PASS`；
   - `summary` → `FAIL: 0`；
   - `conform.json` 维持 `pass 33 / declaredAbsent 0 / unverified 0`（能力地板本来就达标）；
   - 记录状态转为 `verified-awaiting-governance-git`，第 6 步提交后显示"接入完成"。
5. 复算：`node scripts/verify-onboarding.mjs E:\ai dsh`（八项 + digest）。

## 六、本版不含 / 边界

- **只改判据选格**。锚定代、对齐事务、预检降警告等仍是 0.5.3 的内容。
- 未动共享三仓字节，未改其它平台配置，未跑任何真实矩阵（本版交付前只在临时工作区与真实工作区上做**只读**实算）。
- 若某平台声明了一个**盘上不存在**的版本，该格会如实失败（本机六平台已核对，无此情况）。
