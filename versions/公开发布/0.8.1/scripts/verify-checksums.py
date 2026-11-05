"""Read-only verification of the files listed in REPOSITORY-SHA256SUMS."""
import hashlib
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest = root / "REPOSITORY-SHA256SUMS"
failures = []
checked = 0
for line in manifest.read_text(encoding="utf-8").splitlines():
    if not line:
        continue
    expected, relative = line.split("  ", 1)
    target = (root / relative).resolve()
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or root not in target.parents:
        failures.append(relative + ": invalid manifest entry")
        continue
    if not target.is_file():
        failures.append(relative + ": missing")
        continue
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        failures.append(relative + ": SHA256 differs")
    checked += 1
for failure in failures:
    print(failure)
print("PASS" if not failures else "FAIL", checked, "files checked")
sys.exit(1 if failures else 0)
