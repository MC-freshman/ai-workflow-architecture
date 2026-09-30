"""Exact registered resource closure, authorization and source provenance."""
from pathlib import Path
import re

from packaging.requirements import Requirement

from runtime_core import Rejected, file_hash, relative_path, unlinked


def source(kind, path):
    return {"kind": kind, "path": str(Path(path).absolute()), "sha256": file_hash(path)}


class Resolver:
    def __init__(self, contracts, tool_root, agent_root, bridge, runner, environment, capabilities=None):
        self.c = contracts
        self.scanner = contracts.lint.Scanner(tool_root, agent_root)
        self.bridge = Path(bridge)
        self.runner = Path(runner)
        self.environment = Path(environment) if environment else None
        # ①: optional platform capability document; it carries the declared profile table.
        self.capabilities = Path(capabilities) if capabilities else None

    def choose(self, kind, ident, version=None):
        lint = self.c.lint
        config = lint.read_json(self.bridge)
        if not isinstance(config.get("platform"), str) or not config["platform"] or not config.get("shared", {}).get("readOnly"):
            raise Rejected("UNAUTHORIZED", "Untrusted platform configuration")
        self.scanner.discover()
        if ident not in self.scanner.registered.get(kind, {}):
            raise Rejected("UNAUTHORIZED", "Resource is not enabled in the requested namespace")
        platform_defaults = config.get("defaults") or {}
        if version is not None:
            selected_from = None  # replaced by persisted prepare request provenance
        elif ident in (platform_defaults.get(kind + "Versions") or {}):
            # Platform-scope default override (one-sentence switch writes here; does NOT touch
            # shared current). Generalized from agent-only to workflow/agent so Tools and Agents
            # switch uniformly. Explicit request version still wins (branch above).
            version = platform_defaults[kind + "Versions"][ident]
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
        # 2.1.0 P6 (D-27 semantic half): an unsealed platform has no snapshot to read. The
        # resolution then names no environment, and any workflow that needs one is refused
        # by the requirement check below with a machine-readable code.
        environment = self.c.read(self.environment) if self.environment \
            else {"packages": {}, "pythonVersion": None}
        versions = environment["packages"]
        profiles = agent_lock.get("profiles", {}) if agent_lock else {}
        # ① Declarative profiles: the engine knows no profile literal. The platform declares
        # which profiles it can satisfy (name -> {adapters, requires}); an undeclared or
        # non-matching profile blocks execution exactly as the resolution contract states.
        declared_profiles = {}
        if self.capabilities is not None and self.capabilities.is_file():
            declared_profiles = self.c.read(self.capabilities).get("profiles") or {}
        for profile_name, requirement in sorted(profiles.items()):
            profile = declared_profiles.get(profile_name)
            if not isinstance(profile, dict):
                raise Rejected("CAPABILITY_UNAVAILABLE", "Unsupported required profile: " + str(profile_name))
            if requirement not in (profile.get("adapters") or []):
                raise Rejected("CAPABILITY_UNAVAILABLE", "Unsupported required profile: " + profile_name + "=" + str(requirement))
            for package in profile.get("requires", []):
                if package not in versions:
                    raise Rejected("CAPABILITY_UNAVAILABLE", "Profile " + profile_name + " has no pinned implementation: " + str(package))
        resources = []
        peer_locks = {}
        for key in sorted(closure):
            root = Path(scanner.resources[key]["path"])
            manifest = lint.read_json(root / "manifest.json")
            if manifest.get("peerLock"):
                peer_lock = lint.read_json(relative_path(root, manifest["peerLock"]))
                if peer_lock.get("schema") != "ai-peer-lock/v1" or not isinstance(peer_lock.get("peers"), dict) or not peer_lock["peers"]:
                    raise Rejected("UNAUTHORIZED", "Peer lock schema is invalid: " + str(root))
                if selected[1] in peer_lock["peers"]:
                    raise Rejected("UNAUTHORIZED", "Peer closure cycle: " + selected[1] + " locks itself")
                peer_source = source("peer-lock", relative_path(root, manifest["peerLock"]))
                for peer_ident, peer_version in sorted(peer_lock["peers"].items()):
                    peer_locks.setdefault(("agent", peer_ident, str(peer_version)), peer_source)
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
                    if self.environment is None:
                        raise Rejected("CAPABILITY_UNAVAILABLE", "The platform declares no sealed script environment (config.environmentManifest), so the requirement " + wanted.name + " cannot be satisfied")
                    name = wanted.name.lower().replace("_", "-")
                    actual = environment["pythonVersion"] if name == "python" else next((v for n, v in versions.items() if n.lower().replace("_", "-") == name), None)
                    if actual is None or actual not in wanted.specifier:
                        raise Rejected("CAPABILITY_UNAVAILABLE", "Pinned environment does not satisfy " + wanted.name)
            origin_path = relative_path(root, manifest["toolLock"]) if key[0] == "agent" else root / "manifest.json"
            origin_kind = "tool-lock" if key[0] == "agent" else "dependency-lock"
            edges = [{"key": child[0] + ":" + child[1], "version": child[2], "source": source(origin_kind, origin_path)} for child in sorted(scanner.edges.get(key, []))]
            resolved_from = selected_from if key == selected else source("dependency-lock", origin_path)
            if key in peer_locks:
                resolved_from = peer_locks[key]
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
        # The contract dependency records the release this platform actually pins,
        # not a build-time constant (F1: platform overrides must stay self-consistent).
        # G-B: under a standalone contracts package the resource SCANNER is the repo-lint
        # release declared separately; in the legacy layout c.scanner IS c.release (identical).
        contract_version = lint.read_json(self.c.scanner / 'manifest.json')['version']
        resources[-1]['dependencies'].append({'key': contract_key, 'version': contract_version, 'source': source('dependency-lock', self.runner / 'manifest.json')})
        # ⑥ The platform pin is authoritative for the contract key (F1). A build-time
        # declaration in any manifest -- including this runner's own -- is a record, not an
        # override, so an existing closure entry for the contract key is replaced by the
        # pinned release instead of conflicting with it (engine self-resolve case).
        contract_record = {'key': contract_key, 'kind': 'workflow', 'id': 'repo-lint', 'version': contract_version, 'path': str(self.c.scanner), 'manifestSha256': file_hash(self.c.scanner / 'manifest.json'), 'contentManifestSha256': file_hash(self.c.scanner / 'SHA256SUMS'), 'resolvedFrom': source('dependency-lock', self.runner / 'manifest.json'), 'dependencies': []}
        # D-97: record the contracts generation this run is prepared under, so a resume can
        # refuse (instead of silently switching) when the platform config now resolves a
        # different generation. The row is written once here; engine.plan() re-validates it.
        contracts_version = lint.read_json(self.c.release / 'manifest.json')['version']
        resources.append({'key': 'contracts:runtime-contracts', 'kind': 'contracts', 'id': 'runtime-contracts', 'version': contracts_version, 'path': str(self.c.release), 'manifestSha256': file_hash(self.c.release / 'manifest.json'), 'contentManifestSha256': file_hash(self.c.release / 'SHA256SUMS'), 'resolvedFrom': source('explicit', self.c.release / 'manifest.json'), 'dependencies': []})
        if selected[0] == 'workflow' and selected[1] == 'repo-lint' and selected[2] != contract_version:
            # F2 / defect ③: the entry selection is authoritative. Replacing the caller's
            # explicit repo-lint version with the pinned scanner release broke "resolve
            # once, then freeze" (invariant 2), hid the platform default from provenance,
            # and did it after prepare had already answered ok:true. Fail closed with the
            # code the error envelope already sanctions; nothing is written yet, so no run
            # can be left wedged in `prepared` by a later claim/stop revalidation.
            raise Rejected("VERSION_CONFLICT", "Selected workflow:repo-lint@" + selected[2]
                           + " conflicts with this platform's scannerRelease repo-lint@" + contract_version
                           + "; align the pin or request " + contract_version)
        if selected == ('workflow', 'repo-lint', contract_version):
            # F2b: the version was already aligned above, so this record describes the very
            # resource the caller selected. Its resolvedFrom must stay the selection origin
            # (explicit / shared-current / platform-default), not the runner's own manifest.
            contract_record['resolvedFrom'] = selected_from
        contract_index = next((index for index, row in enumerate(resources) if row['key'] == contract_key), None)
        if contract_index is None:
            resources.append(contract_record)
        else:
            resources[contract_index] = contract_record
        environment_edges = []
        for name, actual in (sorted(versions.items()) if self.environment else []):
            ident = name.lower().replace('_', '-')
            kind = 'renderer' if ident == 'matplotlib' else 'library'
            version = re.sub(r'\.post(\d+)$', r'-post\1', actual)
            if re.fullmatch(r'\d+\.\d+', version):
                version += '.0+pep440.' + actual
            if not lint.valid_version(version):
                raise Rejected('CAPABILITY_UNAVAILABLE', 'Environment version lacks an exact contract representation')
            environment_edges.append({'key': kind + ':' + ident, 'version': version, 'source': source('environment-snapshot', self.environment)})
            resources.append({'key': kind + ':' + ident, 'kind': kind, 'id': ident, 'version': version, 'path': str(self.environment), 'manifestSha256': file_hash(self.environment), 'contentManifestSha256': file_hash(self.environment), 'resolvedFrom': source('environment-snapshot', self.environment), 'dependencies': []})
        for label, kind, version in ([("python", "interpreter", environment["pythonVersion"])] if self.environment else []):
            resources.append({"key": kind + ":" + label, "kind": kind, "id": label, "version": version, "path": str(self.environment), "manifestSha256": file_hash(self.environment), "contentManifestSha256": file_hash(self.environment), "resolvedFrom": source("environment-snapshot", self.environment), "dependencies": environment_edges})
        # The environment manifest pins every installed distribution and native
        # runtime file; it is one interpreter-root snapshot, not guessed versions.
        return {"selection": {"agent": selected[0] + ":" + selected[1] if selected[0] == "agent" else None, "workflow": target[0] + ":" + target[1], "runner": "runner:wf-runner",
                          "environment": (["interpreter:python"] if self.environment else [])}, "resources": resources, "target": Path(scanner.resources[target]["path"]), "findings": scanner.findings, "environment": environment}
