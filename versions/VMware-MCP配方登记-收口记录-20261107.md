# VMware MCP 配方正式登记 — 收口记录（2026-11-07）

> 判据载体 `versions/VMware-MCP配方正式登记-P表-20261107.md`；用户 2026-11-07 指令「① 先把 VMware 这份正式登记进管理台」＝批准。逐 P 读数见 P 表 §6，本文件只给**四项入库读数**与维护期项。
> 性质：共享仓登记面 + 本平台诚实声明维护，`agent/workflow = null`，未执行业务 run、未抬共享 `current`、未发包、未改管理台源码。

## 1. 一句话结论

`vmware-workstation@1.0.0`（`mcp-stdio`，21 工具）已按三仓同构正式登记进 `software/registry.json`，机器判据把它解析为 `mcp-stdio / 1.0.0 / 21 capabilities / windows`，自身 findings 0；**已发布的 `versions/1.0.0/` 字节一个未改**。这是**共享侧登记完成**，不是平台可派发（D-60）。

## 2. 四项入库读数（BP-6，按实盘，不谎报）

| # | 读数 | 实盘 |
|---|---|---|
| 1 | HEAD sha | 实现提交 **`5512dedf79d518e852303d5707ae306adfb4377e`**（46 文件：41 份配方 + 5 处改动）。本收口记录为随后一笔提交，其 sha 由 `git log -1` 回读，不预填。此前回滚点 `64d5254c` 为两份文档的单独提交。 |
| 2 | 白名单内 `git status` 空 | **本轮路径集合为空（已全部入库）** ✅：`software/registry.json`、`software/README.md`、`software/vmware-workstation/`（41 文件）、`workbuddy/bridge/capabilities.json`、`versions/更新日志.md`、P 表与方案文档。**但全仓 status 非空**，剩余 2 项均非本轮引入、未动：`M qoder/bridge/client-adapter.json`（他平台配置面，BP-2 平台隔离）、`?? software/PacketTracer 8.0/`（11-06 用户明示新增、裁定为登记例外，不入库）。 |
| 3 | 远端与本地一致 | ❌ **不满足**。`origin/main` = `a4df139378489d6b610dd8b2d68a54e15677e3d5`；本地领先 3 笔（`f126eccc` → `64d5254c` → `5512dedf`），提交本记录后领先 4 笔。环境注入代理 `34483` 推送报 `schannel: server closed abruptly (missing close_notify)`；按本机既有做法实测历史与注入端口 `34483 / 7897 / 20168 / 56224 / 22072 / 2680 / 5354 / 9080 / 5018 / 9948`，`curl -m 4 -x … https://github.com` **全部 `000`**，`ls-remote` 亦 `Empty reply from server`。**推送未执行成功，不把本轮称作「远端一致」**；按 BP-6，无该项读数不得宣称完整收口。 |
| 4 | 入库早于破坏动作 | ✅ 回滚点 `64d5254c`（两份文档单独提交）早于 P2 的目录改名 `mv`；改名后 41 文件数不变、3 份关键文件 sha256 逐字一致、封条 39/39 OK。 |

**用户终端待执行（开梯子后一条命令）**：
```
git -C E:/ai -c http.proxy=$HTTPS_PROXY push origin main
```
推完回读 `git -C E:/ai ls-remote origin refs/heads/main` 与 `git -C E:/ai status -sb`（应 `ahead 0`），再把 `ahead 0` 读数补登记到本文件与 `更新日志.md`。推送前无需再跑其余判据。

## 3. 判据摘要（详见 P 表 §6）

- `repo-lint 0.7.0` 软件面直调：4 errors / 10 warnings，**4 条全为既有基线**（nmap ×3、`_connector` ×1，与 10-30 读数一致），`vmware-workstation` findings **0**；全仓 `--scope snapshot` 在会话内被 SIGTERM，改用 `software_lint.lint_software_root` 直调（本平台隔离 venv `jsonschema 4.25.1`）。
- `platform-conformance 1.6.3 --only vmware-workstation`：`unknownOnlyIds=[]`、判到 1 行 `unverified`、`remediationMissing=[]`、`unionSha256=44f2f9fd76de…`；`floorReached=False` 因该行未验证，属诚实读数。
- `check-governance-drift.mjs` `ok=true / failed=[]`；`check-runtime-drift.mjs` `ok=true / drifted=[]`；三仓发布目录 `__pycache__` 复查 0（`python -B` + `PYTHONDONTWRITEBYTECODE=1`）。
- 现行权威 conform digest `f6151a48…` **未失效**（`sourceSnapshot` 不含 software 仓）；`docs-manifest.json` 白名单不含本轮治理文本，未触发 C3/C9/C11，未重算源锁。

## 4. 维护期项（按 BP-5 归完成后，不计入本轮判据）

1. **平台侧派发注册**：`nativeMcpServers` / `softwareProfiles` 网关注册仍待各平台按 intake 流程自证；本平台 `gapPlan` 已写补齐路径（90 分钟），未代其它平台出证。
2. **1.0.1 README 修正**：已发布 `1.0.0/README.md:46` 启动示例仍指旧目录 `software/VMware/...`、`:52` 示例含 `E:\ai\qoder-cn\workspaces`；因已发布只读本轮未改。用户若已按旧路径配置 MCP 客户端，请改为 `software/vmware-workstation/versions/1.0.0/src/server.mjs`。
3. **图书馆索引**：`versions/README.md` / `CATALOG.md` 的逐文件书目尚未纳入本轮 3 份新文档（非白名单源文，不影响源锁），下次重算书目时一并补，本轮未动以免份数与书目不一致。
4. **git 推送**：见 §2 第 3 项，用户终端执行并回填读数。

## 5. 同批交付但不实施的部分

`versions/管理台MCP-Server方案与P表-20261107.md`（用户指令 ②③）已落盘：C 语义（管理台自己作为 MCP Server）的**方案 + 完整 P 表 P1–P6**，文首明写「**方案，未获批准，零实施授权**」。本会话**未写任何 MCP Server 代码、未改 `cli.mjs`、未改 `conform.mjs`、未新增 npm script**。需用户单独「整体批准」后才可开 P1。

## 6. 完成判定

P1–P5 按 P 表预先写明的判据全部跑完，**三项入库读数满足、第 3 项（远端一致）因代理不可用未满足** ⇒ 按 BP-6 本轮判为「**实现完成、收口读数待推送补齐**」，不谎报为完整收口。等待型项归维护期；同一轮内未追加验收项、未提高判据门槛。
