#!/usr/bin/env python3
"""AUDIT script stage 入口（executor-adoption 试点）。

由 runner 以 script stage 形态派发。沙箱事实（sandbox_linux.py：chroot jail）：
脚本世界 = /release + /work（cwd，可写）+ /scratch + /environment + /shared；
evidence 在 jail 外不可见。因此输入由 host 预摆进 work：
  - WORK 交付物副本：work/data/raw/work-output.json（引擎专门只读绑定的输入区）
  - deliverable 实体文件：work/deliverables/...（deliverables[].path 相对 cwd 声明）

退出码：
  0 = 全部 deliverable 均可核验
  1 = 存在缺失 / 不可读的 deliverable（manifest 内逐条记录 reason）
  2 = 输入缺失或不可解析（非 repair 场景）

只读既有文件；除 audit-manifest.json 外不写任何路径。纯标准库，兼容
Windows 密封环境与 WSL/chroot 内的 python3。
"""
import hashlib
import json
import os
import sys

OUTPUT_NAME = "audit-manifest.json"
INPUT_CANDIDATES = ("data/raw/work-output.json", "output.json")


def locate_work_output():
    for rel in INPUT_CANDIDATES:
        if os.path.isfile(rel):
            return rel
    return None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    work_path = locate_work_output()
    if not work_path:
        print("MISSING_INPUT: neither %s exists in the script cwd" % " nor ".join(INPUT_CANDIDATES), file=sys.stderr)
        return 2
    try:
        with open(work_path, encoding="utf-8-sig") as stream:
            work = json.load(stream)
    except ValueError as exc:
        print("UNPARSEABLE_INPUT: " + work_path + ": " + str(exc), file=sys.stderr)
        return 2

    deliverables = work.get("deliverables")
    if not isinstance(deliverables, list):
        deliverables = []

    entries = []
    status = "passed"
    for item in deliverables:
        if not isinstance(item, dict):
            entries.append({"name": None, "kind": "invalid", "exists": False, "reason": "not-an-object"})
            status = "failed"
            continue
        name = item.get("name")
        path = item.get("path")
        inline = item.get("inline")
        if path:
            target = path if os.path.isabs(path) else os.path.normpath(os.path.join(os.getcwd(), path))
            if os.path.isfile(target):
                stat = os.stat(target)
                entries.append({
                    "name": name, "kind": "file", "path": path, "exists": True,
                    "bytes": stat.st_size, "sha256": sha256_file(target),
                })
            else:
                entries.append({
                    "name": name, "kind": "file", "path": path, "exists": False,
                    "reason": "file-not-found",
                })
                status = "failed"
        elif inline is not None:
            payload = inline.encode("utf-8") if isinstance(inline, str) else json.dumps(inline, ensure_ascii=False).encode("utf-8")
            entries.append({
                "name": name, "kind": "inline", "exists": True,
                "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
            })
        else:
            entries.append({"name": name, "kind": "absent", "exists": False, "reason": "no-path-no-inline"})
            status = "failed"

    manifest = {
        "schema": "executor-adoption/audit-manifest/v1",
        "status": status,
        "source": {"stage": "WORK", "outputPath": work_path},
        "deliverableCount": len(deliverables),
        "auditedCount": len(entries),
        "entries": entries,
    }
    with open(OUTPUT_NAME, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return 0 if status == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
