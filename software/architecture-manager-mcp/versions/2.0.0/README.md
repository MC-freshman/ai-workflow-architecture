# Architecture Manager MCP (v2 full takeover)

Zero-dependency stdio MCP (Node >= 20), 20 tools. Full headless takeover of architecture governance state: 10 core reads, explicit-whitelist injected domain calls, and confirmed write tools.

## Start

```bash
node <release>/src/server.mjs
```

Roots are injected by the platform (never hardcoded here): `ARCH_WORKSPACE_ROOT, ARCH_MANAGER_ROOT`.

## Tool groups

| group | tools |
|---|---|
| core read | arch_software_list, arch_software_read, arch_versions_current, arch_defects_list, arch_conform_status, arch_governance_status, arch_platform_pins, arch_baseline_read, arch_updates_read, arch_registry_all, arch_capabilities, arch_call, arch_inventory, arch_adoption_read, arch_three_layer, arch_anchor_state, arch_plan, arch_release_gate_draft, arch_defects_status_plan |
| write (confirmed) | arch_relayout_apply |

## Boundaries

- Read tools are open; injected tools return `CAPABILITY_UNAVAILABLE:<tool>` with a remediation path when roots are missing.
- `*_call` only accepts functions in the explicit whitelist; write functions are reachable solely through confirmed write tools.
- Write tools require `*.plan` then `planId` + `confirmToken` (5 min, one-shot, hash-checked); replay/tool drift gives `PLAN_DRIFT`.
- All responses pass `redact()`; `novel.config` returns allow-listed fields only.
- Shared repository carries no absolute paths (BP-1). GUI driving, cloud model calls, git push and publishing are out of scope by red line.
