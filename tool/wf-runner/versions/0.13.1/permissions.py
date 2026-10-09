"""Permission normalization and comparison for peer delegation (M5-03).

Known vocabulary only; unknown values are rejected, never intersected as raw
strings. A dimension absent from a manifest is 'unspecified': nothing is
asserted, so it cannot contradict the workflow requirement on its own. Two
parties asserting different values for the same dimension is a hard conflict.
"""
from runtime_core import Rejected

KNOWN = {
    "network": {"deny": "closed", "egress-allowlist": "restricted-open"},
    "process": {"isolated-python": "sandboxed", "allowlisted-only": "sandboxed"},
    "filesystem": {"project-scoped": "project", "platform-runtime-write-shared-read-only": "project-plus-runtime"},
}
DIMENSIONS = ("network", "process", "filesystem")


class PermissionDenied(Rejected):
    pass


def normalize(source_label, raw):
    if raw is None:
        return {dimension: "unspecified" for dimension in DIMENSIONS}
    if not isinstance(raw, dict):
        raise PermissionDenied("UNKNOWN_PERMISSION", source_label + ": permissions must be an object")
    normalized = {}
    for dimension in DIMENSIONS:
        value = raw.get(dimension)
        if value is None:
            normalized[dimension] = "unspecified"
        elif value in KNOWN.get(dimension, {}):
            normalized[dimension] = KNOWN[dimension][value]
        else:
            raise PermissionDenied("UNKNOWN_PERMISSION", source_label + ": unknown " + dimension + " value: " + repr(value))
    extra = set(raw) - set(DIMENSIONS)
    if extra:
        raise PermissionDenied("UNKNOWN_PERMISSION", source_label + ": unknown permission dimensions: " + ", ".join(sorted(extra)))
    return normalized


def effective(required_label, required_raw, party_labels_and_raw):
    """required = the workflow/operation demand; parties = platform/parent/peer declarations."""
    required = normalize(required_label, required_raw)
    parties = [(label, normalize(label, raw)) for label, raw in party_labels_and_raw]
    effective_result = {}
    for dimension in DIMENSIONS:
        demanded = required[dimension]
        if demanded == "unspecified":
            raise PermissionDenied("PERMISSION_UNSPECIFIED", required_label + ": required " + dimension + " is not declared")
        asserted = [(label, view[dimension]) for label, view in parties if view[dimension] != "unspecified"]
        values = {value for _, value in asserted}
        if len(values) > 1:
            raise PermissionDenied("PERMISSION_CONFLICT", dimension + " asserted differently: " + repr(sorted(asserted)))
        if values:
            value = values.pop()
            if value != demanded:
                raise PermissionDenied("PERMISSION_EXCEEDED", dimension + ": required " + demanded + " but parties assert " + value)
            effective_result[dimension] = value
        else:
            raise PermissionDenied("PERMISSION_EXCEEDED", dimension + ": required " + demanded + " but no party asserts it")
    return {"required": required, "parties": {label: view for label, view in parties}, "effective": effective_result}
