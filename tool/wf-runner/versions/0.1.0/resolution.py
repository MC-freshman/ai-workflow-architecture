"""Exact registered resource closure, authorization and source provenance."""
from pathlib import Path
import re

from packaging.requirements import Requirement

from runtime_core import Rejected, file_hash, relative_path, unlinked


def source(kind, path):
    return {"kind": kind, "path": str(Path(path).absolute()), "sha256": file_hash(path)}


class Resolver:
    def __init__(self, contracts, tool_root, agent_root, bridge, runner, environment):
        self.c = contracts
        self.scanner = contracts.lint.Scanner(tool_root, agent_root)
        self.bridge = Path(bridge)
        self.runner = Path(runner)
        self.environment = Path(environment)

    def choose(self, kind, ident, version=None):
        lint = self.c.lint
        config = lint.read_json(self.bridge)
        if config.get("platform") != "codex" or not config.get("shared", {}).get("readOnly"):
            raise Rejected("UNAUTHORIZED", "Untrusted platform configuration")
        self.scanner.discover()
        if ident not in self.scanner.registered.get(kind, {}):
            raise Rejected("UNAUTHORIZED", "Resource is not enabled in the requested namespace")
        if version is not None:
            selected_from = None  # replaced by persisted prepare request provenance
        elif kind == "agent" and ident in config.get("defaults", {}).get("agentVersions", {}):
            version = config["defaults"]["agentVersions"][ident]
            selected_from = source("platform-default", self.bridge)
        else:
            version = self.scanner.current.get((kind, ident))
            selected_from = source("shared-current", self.scanner.base(kind, ident) / "current.json")
        if not lint.valid_version(version):
            raise Rejected("INVALID_REQUEST", "Exact semantic version required")
        return (kind, ident, version), selected_from

    def resolve(self, selected, selected_from):
        scanner = self.scanner
        lint = self.c.lint
        scanner.release(*selected)
        agent_lock = None
        allowed = {}
        target = selected
        if selected[0] == "agent":
            root = scanner.base("agent", selected[1]) / "versions" / selected[2]
            manifest = lint.read_json(root / "manifest.json")
            lock_path = relative_path(root, manifest["toolLock"])
            agent_lock = lint.read_json(lock_path)
            for section, kind in (("workflows", "workflow"), ("skills", "skill"), ("packs", "pack")):
                for ident, version in scanner.entries(agent_lock.get(section), selected, section):
                    allowed[(kind, ident)] = version
            workflows = manifest.get("workflows", [])
            # This initial agent adapter requires one explicitly named main workflow.
            main = manifest.get("runnerWorkflow", selected[1] if selected[1] in workflows else None)
            if main is None or ("workflow", main) not in allowed:
                raise Rejected("UNAUTHORIZED", "Agent has no unambiguous exactly authorized main workflow")
            target = ("workflow", main, allowed[("workflow", main)])
        for key in list(scanner.closure(selected)):
            data = scanner.resources.get(key, {})
            if key[0] == "pack":
                for ident in data.get("selectorIds", []):
                    existing = [k[2] for k in scanner.closure(selected) if k[:2] == ("skill", ident)]
                    if len(set(existing)) > 1:
                        raise Rejected('UNAUTHORIZED', 'Strict dependency closure blocked: version-conflict')
                    version = allowed.get(("skill", ident)) or (existing[0] if len(set(existing)) == 1 else None)
                    if version is None:
                        raise Rejected("UNAUTHORIZED", "Unversioned pack member lacks an exact consuming lock")
                    scanner.dependency(key, "skill", ident, version)
        scanner.check_closures()
        closure = scanner.closure(selected)
        blockers = [f for f in scanner.findings if f["severity"] == "error" and (f["kind"] == "repository" or (f["kind"], f["id"], f["version"]) in closure or (not f["version"] and any(k[:2] == (f["kind"], f["id"]) for k in closure)))]
        if blockers:
            raise Rejected("UNAUTHORIZED", "Strict dependency closure blocked: " + ", ".join(sorted({f["code"] for f in blockers})))
        environment = self.c.read(self.environment)
        versions = environment["packages"]
        profiles = agent_lock.get("profiles", {}) if agent_lock else {}
        if profiles and profiles != {"renderer": "matplotlib-adapter-first"}:
            raise Rejected("CAPABILITY_UNAVAILABLE", "Unsupported required profile")
        if profiles and "matplotlib" not in versions:
            raise Rejected("CAPABILITY_UNAVAILABLE", "Renderer profile has no pinned implementation")
        resources = []
        for key in sorted(closure):
            root = Path(scanner.resources[key]["path"])
            manifest = lint.read_json(root / "manifest.json")
            if manifest.get("peerLock"):
                raise Rejected("CAPABILITY_UNAVAILABLE", "Peer execution is outside Phase 1")
            if key[0] == "skill" and isinstance(manifest.get("requires"), dict):
                raise Rejected("UNSUPPORTED_SCHEMA", "Unknown Skill requirement format")
            requirements = manifest.get("requires", []) if key[0] == "skill" else manifest.get("dependencies", [])
            if isinstance(requirements, list):
                for requirement in requirements:
                    if not isinstance(requirement, str) or "@" in requirement:
                        continue
                    try:
                        wanted = Requirement(requirement)
                    except Exception as exc:
                        raise Rejected("CAPABILITY_UNAVAILABLE", "External requirement has no supported interpretation") from exc
                    name = wanted.name.lower().replace("_", "-")
                    actual = environment["pythonVersion"] if name == "python" else next((v for n, v in versions.items() if n.lower().replace("_", "-") == name), None)
                    if actual is None or actual not in wanted.specifier:
                        raise Rejected("CAPABILITY_UNAVAILABLE", "Pinned environment does not satisfy " + wanted.name)
            origin_path = relative_path(root, manifest["toolLock"]) if key[0] == "agent" else root / "manifest.json"
            origin_kind = "tool-lock" if key[0] == "agent" else "dependency-lock"
            edges = [{"key": child[0] + ":" + child[1], "version": child[2], "source": source(origin_kind, origin_path)} for child in sorted(scanner.edges.get(key, []))]
            resolved_from = selected_from if key == selected else source("dependency-lock", origin_path)
            if key != selected:
                for parent in sorted(closure):
                    if key in scanner.edges.get(parent, []):
                        parent_root = Path(scanner.resources[parent]["path"])
                        parent_manifest = lint.read_json(parent_root / "manifest.json")
                        parent_path = relative_path(parent_root, parent_manifest["toolLock"]) if parent[0] == "agent" else parent_root / "manifest.json"
                        resolved_from = source("tool-lock" if parent[0] == "agent" else "dependency-lock", parent_path)
                        break
            resources.append({"key": key[0] + ":" + key[1], "kind": key[0], "id": key[1], "version": key[2], "path": str(root), "manifestSha256": file_hash(root / "manifest.json"), "contentManifestSha256": file_hash(root / "SHA256SUMS"), "resolvedFrom": resolved_from, "dependencies": edges})
        runner_manifest = lint.read_json(self.runner / "manifest.json")
        check = lint.Scanner(scanner.tool, scanner.agent)
        check.integrity(self.runner, runner_manifest, ("workflow", "wf-runner", runner_manifest["version"]))
        if check.findings:
            raise Rejected("HASH_MISMATCH", "Runner source package is incomplete")
        resources.append({"key": "runner:wf-runner", "kind": "runner", "id": "wf-runner", "version": runner_manifest["version"], "path": str(self.runner), "manifestSha256": file_hash(self.runner / "manifest.json"), "contentManifestSha256": file_hash(self.runner / "SHA256SUMS"), "resolvedFrom": source("explicit", self.runner / "manifest.json"), "dependencies": []})
        contract_key = 'workflow:repo-lint'
        resources[-1]['dependencies'].append({'key': contract_key, 'version': '0.1.1', 'source': source('dependency-lock', self.runner / 'manifest.json')})
        if not any(r['key'] == contract_key for r in resources):
            resources.append({'key': contract_key, 'kind': 'workflow', 'id': 'repo-lint', 'version': '0.1.1', 'path': str(self.c.release), 'manifestSha256': file_hash(self.c.release / 'manifest.json'), 'contentManifestSha256': file_hash(self.c.release / 'SHA256SUMS'), 'resolvedFrom': source('dependency-lock', self.runner / 'manifest.json'), 'dependencies': []})
        elif next(r['version'] for r in resources if r['key'] == contract_key) != '0.1.1':
            raise Rejected('UNAUTHORIZED', 'Runner contract dependency conflicts with target closure')
        environment_edges = []
        for name, actual in sorted(versions.items()):
            ident = name.lower().replace('_', '-')
            kind = 'renderer' if ident == 'matplotlib' else 'library'
            version = re.sub(r'\.post(\d+)$', r'-post\1', actual)
            if re.fullmatch(r'\d+\.\d+', version):
                version += '.0+pep440.' + actual
            if not lint.valid_version(version):
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Environment version lacks an exact contract representation')
            environment_edges.append({'key': kind + ':' + ident, 'version': version, 'source': source('environment-snapshot', self.environment)})
            resources.append({'key': kind + ':' + ident, 'kind': kind, 'id': ident, 'version': version, 'path': str(self.environment), 'manifestSha256': file_hash(self.environment), 'contentManifestSha256': file_hash(self.environment), 'resolvedFrom': source('environment-snapshot', self.environment), 'dependencies': []})
        for label, kind, version in [("python", "interpreter", environment["pythonVersion"])]:
            resources.append({"key": kind + ":" + label, "kind": kind, "id": label, "version": version, "path": str(self.environment), "manifestSha256": file_hash(self.environment), "contentManifestSha256": file_hash(self.environment), "resolvedFrom": source("environment-snapshot", self.environment), "dependencies": environment_edges})
        # The environment manifest pins every installed distribution and native
        # runtime file; it is one interpreter-root snapshot, not guessed versions.
        return {"selection": {"agent": selected[0] + ":" + selected[1] if selected[0] == "agent" else None, "workflow": target[0] + ":" + target[1], "runner": "runner:wf-runner", "environment": ["interpreter:python"]}, "resources": resources, "target": Path(scanner.resources[target]["path"]), "findings": scanner.findings, "environment": environment}
