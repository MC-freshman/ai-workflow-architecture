"""R-P1 复算命令：python -B versions/缺陷状态簿.check.py
机器可判：结构、状态集、红行点名、closed/absorbed/ruled 行的 source 必须在盘上存在。
退出码 0 = 簿子纪律成立；1 = 有红线违规（逐条点名）。"""
import hashlib, json, sys, re
from pathlib import Path

BOOK = Path(__file__).parent / "缺陷状态簿.json"
ALLOWED = {"open", "closed", "absorbed", "ruled", "unverified-registration"}
RED = {"open", "unverified-registration"}
ROOT = Path(__file__).parent.parent

def main():
    raw = BOOK.read_bytes()
    book = json.loads(raw.decode("utf-8-sig"))
    rows = book.get("defects") or []
    errors, red = [], []
    ids = [r.get("id") for r in rows]
    if len(ids) != len(set(ids)):
        errors.append("duplicate ids")
    for r in rows:
        rid = r.get("id", "?")
        for field in ("title", "status", "location", "source"):
            if not r.get(field):
                errors.append(f"{rid}: missing {field}")
        st = r.get("status")
        if st not in ALLOWED:
            errors.append(f"{rid}: illegal status {st!r}")
            continue
        if st in RED:
            red.append(rid)
        if st in ("closed", "absorbed", "ruled"):
            src = r.get("source", "")
            # source 允许携带人类注解（§节名/段名/行号/补充说明）；机器判据只要求
            # 其中可解析出的文件路径主元真实存在。解析：按空白切分取首元，剥尾部
            # :行号；再退化尝试 '；'/‘+’分段后的各首元。
            cands = []
            for part in [src] + [p for sep in ("；", ";", "+") for p in src.split(sep)]:
                tok = part.strip().split()[0] if part.strip() else ""
                if not tok:
                    continue
                tok = re.sub(r":\d+(-\d+)?$", "", tok)
                cands.append(tok)
            hit = any((ROOT / c).exists() for c in cands)
            if not hit:
                errors.append(f"{rid}: {st} row's source does not exist on disk: {src[:80]}")
    # 从当前合法 ID 派生上界；保留已有 D-25..D-97 基线，新增号段同样查跳号。
    have = set()
    for rid in ids:
        if not isinstance(rid, str) or not re.fullmatch(r"D-[1-9][0-9]*", rid):
            errors.append(f"illegal id: {rid!r}")
        else:
            have.add(int(rid[2:]))
    missing = [f"D-{n}" for n in range(25, max({97, *have}) + 1) if n not in have]
    if missing:
        errors.append(f"range gaps (each number must have a row): {missing}")
    digest = hashlib.sha256(raw).hexdigest()
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(json.dumps({
        "schema": "ai-defect-status-book-digest/v1",
        "digest": digest[:16],
        "rows": len(rows),
        "counts": counts,
        "redRows": red,
        "ok": not errors,
        "errors": errors,
    }, ensure_ascii=False))
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
