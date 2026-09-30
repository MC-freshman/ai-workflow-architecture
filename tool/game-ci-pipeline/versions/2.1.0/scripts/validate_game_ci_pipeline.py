#!/usr/bin/env python3
"""game-ci-pipeline 交付物完整性门禁（Z10 §6.2 批 C1）。

在 EXECUTE 尝试的证据目录内运行：读取 output.json，写 game-ci-pipeline-check.json，
退出 0/1/2。

上游的硬规则：流水线必须无环、每个构建目标都要有阶段承接、密钥只从密钥库引用
（不得内联明文）、发布通道必须显式声明是否需要人工批准。
"""
import json
import sys

PLACEHOLDERS = ("tbd", "todo", "fixme", "待定", "占位", "lorem ipsum", "<placeholder>")
SECRET_SOURCES = ("ci-secret-store", "vault", "env")


def load(fs):
    try:
        with open("output.json", encoding="utf-8-sig") as stream:
            return json.load(stream)
    except FileNotFoundError:
        fs.append("MISSING_INPUT: output.json was not sealed")
    except ValueError as exc:
        fs.append("UNPARSEABLE_INPUT: output.json: " + str(exc))
    return None


def write_check(status, findings, reason=None):
    with open("game-ci-pipeline-check.json", "w", encoding="utf-8") as stream:
        json.dump({"status": status, "reason": reason or (findings[0] if findings else "passed"),
                   "findings": findings}, stream, ensure_ascii=False, indent=2)


def blanks(value, path):
    found = []
    if isinstance(value, str):
        low = value.lower()
        found += ["PLACEHOLDER_TEXT: " + path + " contains " + t for t in PLACEHOLDERS if t in low]
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += blanks(item, path + "[" + str(index) + "]")
    elif isinstance(value, dict):
        for key, item in value.items():
            found += blanks(item, path + "." + str(key))
    return found


def cycle(graph):
    state, path = {}, []

    def visit(node):
        if state.get(node) == "open":
            return path[path.index(node):] + [node]
        if state.get(node) == "done":
            return None
        state[node] = "open"
        path.append(node)
        for neighbour in graph.get(node, []):
            loop = visit(neighbour)
            if loop:
                return loop
        path.pop()
        state[node] = "done"
        return None

    for node in graph:
        loop = visit(node)
        if loop:
            return loop
    return None


def main():
    findings = []
    doc = load(findings)
    if doc is None:
        write_check("violations", findings)
        return 1
    blockers = doc.get("blockers") or []
    if doc.get("status") == "blocked" and blockers and all(str(i).startswith("MISSING_INFO") for i in blockers):
        write_check("missing-info", ["MISSING_INFO: " + str(i) for i in blockers])
        return 2

    stages = doc.get("stages") or []
    ids = [str(item.get("id", "")) for item in stages]
    if len(stages) < 4:
        findings.append("STAGES_TOO_FEW: " + str(len(stages)) + " < 4")
    if len(set(ids)) != len(ids):
        findings.append("DUPLICATE_STAGE_ID: stage ids must be unique")
    graph = {}
    for index, item in enumerate(stages):
        if int(item.get("timeoutMinutes", 0) or 0) <= 0:
            findings.append("STAGE_WITHOUT_TIMEOUT: stages[" + str(index) + "] has no positive timeout")
        deps = [str(v) for v in item.get("dependsOn", [])]
        for ref in deps:
            if ref not in ids:
                findings.append("UNKNOWN_STAGE_DEPENDENCY: stages[" + str(index) + "] depends on " + repr(ref))
        graph[str(item.get("id", ""))] = [ref for ref in deps if ref in ids]
    loop = cycle(graph)
    if loop:
        findings.append("STAGE_CYCLE: " + " -> ".join(loop))

    targets = doc.get("buildTargets") or []
    if len(targets) < 2:
        findings.append("TARGETS_TOO_FEW: " + str(len(targets)) + " < 2")
    built = set()
    for index, item in enumerate(targets):
        refs = [str(v) for v in item.get("stages", [])]
        if not refs:
            findings.append("UNBUILT_TARGET: buildTargets[" + str(index) + "] has no build stage")
        for ref in refs:
            if ref not in ids:
                findings.append("UNKNOWN_TARGET_STAGE: buildTargets[" + str(index) + "] cites " + repr(ref))
            else:
                built.add(ref)
    for index, item in enumerate(stages):
        if item.get("kind") == "build" and str(item.get("id", "")) not in built:
            findings.append("ORPHAN_BUILD_STAGE: " + str(item.get("id")) + " builds nothing")

    for index, item in enumerate(doc.get("secrets") or []):
        if item.get("source") not in SECRET_SOURCES:
            findings.append("BAD_SECRET_SOURCE: secrets[" + str(index) + "] must come from " + "/".join(SECRET_SOURCES))
        for ref in [str(v) for v in item.get("usedBy", [])]:
            if ref not in ids:
                findings.append("UNKNOWN_SECRET_STAGE: secrets[" + str(index) + "] is used by " + repr(ref))

    channels = (doc.get("deployment") or {}).get("channels") or []
    if not channels:
        findings.append("NO_DEPLOY_CHANNEL: deployment.channels is empty")
    for index, item in enumerate(channels):
        if item.get("requiresApproval") is not True:
            findings.append("STORE_WITHOUT_APPROVAL: channels[" + str(index) + "] publishes without human approval")

    findings += blanks(doc, "output")
    write_check("violations" if findings else "pass", findings)
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
