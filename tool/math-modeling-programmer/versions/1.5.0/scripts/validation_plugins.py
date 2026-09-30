"""Small, composable validation plugins used by run_validations.py."""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass
class CheckResult:
    check_id: str
    name: str
    status: str
    expected: Any = None
    observed: Any = None
    evidence: str = ""
    message: str = ""
    impact: str = ""

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def file_exists(check_id: str, root: Path, relative: str) -> CheckResult:
    path = (root / relative).resolve()
    ok = path.is_file() and root.resolve() in path.parents
    return CheckResult(check_id, "file_exists", "PASS" if ok else "FAIL", True, ok, relative,
                       "文件存在" if ok else "文件不存在", "缺失产物会阻止结果交付")


def json_field_equals(check_id: str, root: Path, relative: str, field: str, expected: Any) -> CheckResult:
    path = (root / relative).resolve()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        observed = payload
        for part in field.split("."):
            observed = observed[part]
        ok = observed == expected
        message = "字段符合预期" if ok else "字段值不一致"
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        observed = None
        ok = False
        message = str(exc)
    return CheckResult(check_id, "json_field_equals", "PASS" if ok else "FAIL", expected, observed, relative, message, "结果字段不一致")


def numeric_close(check_id: str, observed: Any, expected: float, tolerance: float) -> CheckResult:
    try:
        observed_number = float(observed)
        ok = math.isfinite(observed_number) and abs(observed_number - expected) <= tolerance
    except (TypeError, ValueError):
        observed_number = observed
        ok = False
    return CheckResult(check_id, "numeric_close", "PASS" if ok else "FAIL", expected, observed_number, "", "数值在容差内" if ok else "数值超出容差", "会影响结论")


def run_check(root: Path, check: dict[str, Any]) -> CheckResult:
    kind = check.get("type")
    check_id = str(check.get("id", kind or "CHECK"))
    if kind == "file_exists":
        return file_exists(check_id, root, str(check["path"]))
    if kind == "json_field_equals":
        return json_field_equals(check_id, root, str(check["path"]), str(check["field"]), check.get("expected"))
    if kind == "numeric_close":
        return numeric_close(check_id, check.get("observed"), float(check["expected"]), float(check.get("tolerance", 1e-9)))
    if kind == "not_run":
        return CheckResult(check_id, "not_run", "NOT_RUN", message=str(check.get("reason", "未执行")), impact="需人工决定是否阻止冻结")
    return CheckResult(check_id, str(kind), "FAIL", message=f"未知验证插件: {kind}", impact="验证配置无效")


PLUGIN_TYPES: dict[str, Callable[..., CheckResult]] = {
    "file_exists": file_exists,
    "json_field_equals": json_field_equals,
    "numeric_close": numeric_close,
}
