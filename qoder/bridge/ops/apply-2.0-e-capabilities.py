"""把 2.0-E 三轮的结果登记进 bridge/capabilities.json（只动四格，改前改后做逐键差分自证）。

写这台平台的账必须保守：闭合的格要把 run id、证据文件与**残余未测面**一起留下，
不把「没做真·断电级崩溃」混进「崩溃恢复没测」，也不把结论外推到别的平台或别的门禁实例。
"""
import json
from pathlib import Path

CFG = Path("E:/ai/qoder/bridge/capabilities.json")
raw = CFG.read_bytes()
before = json.loads(raw.decode("utf-8-sig"))

PROCESS = ("**已实测到闭合（2026-09-19，0.7.7 字节面）**：run `q2e-e2-gate-18161506`"
           "（`game-sprint-plan@2.1.1` 的 `review` 阶段，门禁 `plan-integrity` 类型 `process`）一条 run 吃三格："
           "attempt 1 故意放进被改坏的 `capacity.json` ⇒ 引擎真跑 `validate_plan.py` 抓到 "
           "`CAPACITY_MISMATCH: declared 89.0 != members*buffer 96.0` ⇒ 按 `onFail: repair` 开 attempt 2 ⇒ "
           "订正后通过 ⇒ run `succeeded`；另钉一条陈旧门禁绑定（`gate.outputManifestSha256` 对不上）"
           "在**跑子进程之前**就被 `GATE_FAILED` 拒，且被拒那次在 `evidence/review/2/` 里既不留 `plan-check.json` "
           "也不留 `_gateexec/`。机检 `../runtime/maintenance/2.0-E/baseline/E2-process-gate-077.json`（29 项全绿）。"
           "更早的 0.6.0 面：`qoder-process-gate-20260915-213801`（通过）与 `…-214053`（同一门禁喂被改坏的决定 ⇒ 拒）。"
           "**残余未测（不构成本能力位缺口，但不得外推）**：① 只跑过 `plan-integrity` 这一个门禁实例，"
           "其它声明 process 门禁的释放（`game-design-review 2.1.0`、`game-postmortem 2.1.0`）各自未跑；"
           "② process 门禁走 `gate_exec` 的**主机 sys.executable**，不经 WSL 后端与 `scriptEnvironment`，"
           "它的隔离面与脚本阶段不是同一套；③ 旧措辞「唯一声明 process 门禁的是 repo-lint」已否掉——"
           "`repo-lint@0.3.0` 一个 process 门禁都没有。")

CRASH = ("**已实测到闭合（2026-09-19，0.7.7 字节面，61 项机检全绿）**：用引擎自带的注入点 "
         "`Engine(config, fault=...)`（CLI 从不传 fault ⇒ 只能进程内跑）在四个已 fsync 的提交边界 "
         "`after-intent` / `after-events` / `after-state` / `after-receipt` 各造一次崩溃，每次由**新 Engine 实例**恢复："
         "同一幂等键重试一次即「恢复 + 重放」（拿到崩溃前那次的同一份响应），状态收敛到日志里的 intended、"
         "事件不重不丢、`events.jsonl` 链自洽、journal 归档、收据落盘；四点的撕裂形状互不相同（已机检），"
         "证明四个注入点不是四次同一场景。孤儿派发面（写完 `dispatch-intent`、`start_script` 之前崩）："
         "`status` 先拒 `UNKNOWN_OUTCOME` 且零写入；崩溃后第一个租约内操作会先跑 `reconcile_processes` 推进状态，"
         "所以按旧 revision 发的那次拿 `REVISION_CONFLICT`(retryable=true)，重读后再发即被接受；"
         "被孤立的脚本**永不重放**，run 停在 `blocked`/`unknown-outcome`，之后 `submit` 一律被拒。"
         "证据 `../runtime/maintenance/2.0-E/baseline/E3-crash-recovery-077.json`"
         "（runs `q2e-e3-{intent,events,state,receipt,orphan}-18170802`）。**残余未测**：注入的等价性是"
         "「在 fsync 边界抛异常＝该处进程死亡后留下的同一批字节」，**没做真·进程杀死 / 断电 / OS 级崩溃**；"
         "孤儿面注入点在 `start_script` 之前，真实「进程已起来、宿主被杀」的路径未测"
         "（那需要外部杀死能力，且会真启动一次扫描）。")

LOOP = ("prepare → next(claim) → submit → stop 完整闭环（prompt 与 script 两种阶段都真跑到 succeeded；"
        "脚本阶段=本平台第一条真实业务闭环）。**0.7.7 字节面同形复现（2026-09-19）**：run "
        "`q2e-e1b-clean-18163609` 以 exitCode 0 / landlockAbi 3 / processTreeEnded true 走到 succeeded；"
        "同一轮的 `q2e-e1b-blocked-18163609` 把**失败路径**也钉住（扫描有 blocker ⇒ 脚本非零退出 ⇒ run 判 failed ⇒ "
        "submit 被 `TERMINAL_RUN` 拒 ⇒ 不重放）。证据 `../runtime/maintenance/2.0-E/baseline/"
        "E1b-script-stage-077.json` + `E1b-recheck-077.json`（25 项 live + 10 项对已封存字节的复核 = 35 项全绿）。")

EVID = (before["attested"]["evidence"].rstrip("。") +
        "。能力补格轮（2.0-E，2026-09-19）：`runtime/maintenance/2.0-E/`（驱动 e1 / e1b / e1b_recheck / "
        "e2 / e3 + 只读盘点 r2_inventory.py；证据 baseline/E1-script-stage-077.json、E1b-script-stage-077.json、"
        "E1b-recheck-077.json、E2-process-gate-077.json、E3-crash-recovery-077.json、R2-definition-drift.json；"
        "移交单 HANDOFF-r2-runner-definition.md）")

after = json.loads(json.dumps(before))
after["unverified"]["process-gates"] = PROCESS
after["unverified"]["crash-recovery"] = CRASH
after["attested"]["loop"] = LOOP
after["attested"]["evidence"] = EVID

# 差分自证：只允许这四格变化
def flat(value, prefix=""):
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            out.update(flat(v, prefix + "/" + k))
    else:
        out[prefix] = value
    return out


fa, fb = flat(after), flat(before)
assert set(fa) == set(fb), "键集变了"
changed = sorted(k for k in fa if fa[k] != fb[k])
assert changed == sorted(["/attested/evidence", "/attested/loop", "/unverified/crash-recovery",
                          "/unverified/process-gates"]), changed

new_raw = (json.dumps(after, ensure_ascii=False, indent=2) + "\n").replace("\n", "\r\n").encode("utf-8")
assert raw == (json.dumps(before, ensure_ascii=False, indent=2) + "\n").replace("\n", "\r\n").encode("utf-8"), \
    "round-trip 不保真：文件不是 indent=2 + 末尾换行 + CRLF 的形状，拒绝整文件重排"
CFG.write_bytes(new_raw)
print("capabilities.json updated:", changed, "bytes", len(raw), "->", len(new_raw))
print("re-parse ok:", json.loads(CFG.read_bytes().decode("utf-8-sig"))["platform"])
