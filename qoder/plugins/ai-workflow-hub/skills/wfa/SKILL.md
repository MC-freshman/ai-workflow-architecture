---
name: wfa
description: 用 /wfa <agent-id> [任务描述] 调用 E:\ai 共享专家仓库里的专家 agent，由其 tool-lock 锁定的主工作流经统一 runner 协议执行（prepare→next→submit→stop）。当用户说"用某专家做某事"、"/wfa"、"调用某 agent"时使用。
---

# /wfa — 专家 + 其锁定工作流（qoder）

语法与其余平台一致：`/wfa <agent-id> [@agentVersion] [任务描述]`。

**调用方不得指定工作流或工作流版本**——专家跑哪个工作流由该专家的 `tool-lock.json` 决定；
需要"专家 + 指定工作流"属尚未落地的接口扩展，出现该请求要先说明、不得自行发明语法。

## 1. 解析

1. `agent-id` 版本：显式 `@x.y.z` → 否则读 `E:\ai\agent\<agent-id>\current.json`。
   共享默认切换后下一次调用自动跟随（本平台不做 per-agent 覆盖）。
2. `target = {mode:"agent", id:<agent-id>, version:<解析结果>}`。
3. 专家内部资源一律服从其 `tool-lock.json` 的**精确版本**；显式参数不能绕过锁。
4. 校验 `E:\ai\agent\<id>\versions\<v>\` 的 `manifest.json` + `SHA256SUMS`。共享仓库只读。

## 1.5 用户说"该 agent 已更新，请把默认设为新版本"时

1. **本 skill 不用改**：每次调用现读 `E:\ai\agent\<agent-id>\current.json`（§1），共享默认一换就跟随。
2. **换指针是共享仓库动作**：`ops/switch_defaults.py plan → apply → verify`，报告与备份写到 `E:\ai\qoder\runtime\` 下；
   它改的是四平台共用的默认，**须先有用户明确授权**，且绝不覆盖已发布版本目录。未授权时只做到 plan（只读）。
3. **专家内部资源由新版本决定**：agent 跑哪个工作流/技能/包，看的是**新版本目录里的 `tool-lock.json`**；
   所以"专家要用新工作流"必须是**发布新 agent 版本**，而不是换 tool 默认（换 tool 默认不会动专家的精确锁）。
4. 换完重跑矩阵验收，并按实测错误码更新 `bridge/invocation-exceptions.json`；不重跑不宣称可用。

## 2. 判据（与规范 §8 一致）

`prepare(mode=agent)` 成功解析出主工作流 → `next` 返回的 prompt 中含该专家 `prompt.md` 上下文 → `submit`/`stop` 正常。缺任一项即视为不可调用，如实报告而不是改用直调工作流蒙过。

## 3. 执行

与 `/wf` 同一套 runner、同一配置文件、同一环境要求（`PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`PYTHONDONTWRITEBYTECODE=1`、`-B`），`runId` 前缀改 `qoderagent-`；submit 产物规则、幂等键与修订号规则见 `E:\ai\qoder\bridge\invocation-manual.md` §2。

## 4. qoder 平台的已知不可调用面

`E:\ai\qoder\bridge\invocation-exceptions.json` 登记为 EXPECTED，遇到即照实说明：

- `agent:math-modeling-programmer@1.9.0`、`agent:visualization-engineer@1.6.0` → **不再因 renderer 被拒**：本平台已声明 `profiles.renderer`
  并在隔离环境内实测 matplotlib/Agg 出图（`E:\ai\qoder\runtime\jail-selftest\JAIL-NOTE.md`）。但**求解链在本平台没有完整演练过**，
  交稿级要求要如实说明；历史 EXPECTED 登记以最新一轮矩阵为准，不沿用旧结论。
- 含 `action: script` 的阶段 → 走 `--execute`（本平台已有钉版脚本环境），失败报实测错误码；
  `process` 类门禁由**主机解释器**执行，不经 WSL。
- peer 委派 → 未声明 `peerDispatch`、未提供派发器，**不可用**（实测：既无能力拒绝码也无记账）；**不得借用其他平台的实现**。

数模相关请求无论走 `/wfa` 还是 `/wf`，档位口径都是 `E:\ai\invocation-adapters-spec.md` §3.1：未写档位 = 草稿，非交稿不得称已验证或已冻结，禁止用 runner INIT 清空已有项目。

## 5. 留痕与并发

产物只写 `E:\ai\qoder\runtime\runs\<runId>\`；不同 run 可并行，同一 run 单写者、阶段串行（`maxParallel=1`）。并发唯一权威：规范 §10。失败保留现场，报告 `runId` / 阶段 / 错误码 / 证据路径。
