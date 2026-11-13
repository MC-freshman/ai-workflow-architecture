# Architecture Manager MCP (read-only governance facade)

Zero-dependency stdio MCP server (Node >= 20). A zero-dependency stdio MCP server exposing read-only architecture governance state from the shared workspace.

## Start

```bash
node <release>/src/server.mjs
```

MCP client configuration (field names vary by client; roots are injected by the platform, never hardcoded in this repository):

```json
{"mcpServers": {"architecture-manager-mcp": {"command": "node", "args": ["<release>/src/server.mjs"], "env": {"ARCH_WORKSPACE_ROOT": "${workspaceRoot}"} }}}
```

## Tools

| tool | purpose |
|---|---|
| `arch_software_list` | read-only |
| `arch_software_read` | read-only |
| `arch_versions_current` | read-only |
| `arch_defects_list` | read-only |
| `arch_conform_status` | read-only |
| `arch_governance_status` | read-only |
| `arch_platform_pins` | read-only |

## Boundaries

- Read-only. No shell, no argv passthrough, no network egress, no writes.
- A missing or invalid root produces a structured refusal (`*_ROOT_REQUIRED` / `*_PROJECT_INVALID`), never a guessed path.
- `novel.project.info` returns only allow-listed metadata fields plus top-level key names; model-service configuration is never echoed.
- Shared repository carries no absolute paths (BP-1). Platform-side MCP registration is a separate per-platform decision (BP-2, D-60).
