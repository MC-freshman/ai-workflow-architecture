#!/usr/bin/env python3
"""Dependency-light PDF and LaTeX log checks."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Check a PDF and optional compile log")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--log", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    errors = []
    warnings = []
    if not args.pdf.is_file():
        errors.append(f"找不到 PDF: {args.pdf}")
        data = b""
    else:
        data = args.pdf.read_bytes()
        if not data.startswith(b"%PDF-"):
            errors.append("文件头不是 PDF")
        if not data.rstrip().endswith(b"%%EOF"):
            warnings.append("文件末尾没有标准 %%EOF 标记")
    pages = len(re.findall(rb"/Type\s*/Page(?:\s|/|>)", data)) if data else 0
    if pages == 0 and data:
        warnings.append("未能从 PDF 字节流识别页数，可能需要 Poppler 复核")
    log_text = ""
    if args.log and args.log.is_file():
        log_text = args.log.read_text(encoding="utf-8", errors="replace")
        for pattern, label in [(r"Overfull \\[hv]box", "Overfull box"), (r"LaTeX Warning", "LaTeX warning"), (r"undefined references?", "undefined reference")]:
            count = len(re.findall(pattern, log_text, flags=re.I))
            if count:
                warnings.append(f"{label}: {count} 次")
    payload = {"status": "failed" if errors else "success", "pdf": str(args.pdf), "bytes": len(data), "pages_detected": pages, "errors": errors, "warnings": warnings}
    output = args.output or args.pdf.with_suffix(".pdf_check.json")
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
