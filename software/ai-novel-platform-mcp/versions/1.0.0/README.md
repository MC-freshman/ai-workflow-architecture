# AI Novel Platform MCP (read-only project bridge)

Zero-dependency stdio MCP server (Node >= 20). A zero-dependency stdio MCP server exposing read-only access to an AI Novel Writing Platform project directory.

## Start

```bash
node <release>/src/server.mjs
```

MCP client configuration (field names vary by client; roots are injected by the platform, never hardcoded in this repository):

```json
{"mcpServers": {"ai-novel-platform-mcp": {"command": "node", "args": ["<release>/src/server.mjs"], "env": {"NOVEL_PROJECT_ROOT": "${novelProjectRoot}"} }}}
```

## Tools

| tool | purpose |
|---|---|
| `novel_project_info` | read-only |
| `novel_chapter_list` | read-only |
| `novel_chapter_read` | read-only |
| `novel_character_list` | read-only |
| `novel_world_list` | read-only |
| `novel_knowledge_status` | read-only |
| `novel_analysis_state` | read-only |

## Boundaries

- Read-only. No shell, no argv passthrough, no network egress, no writes.
- A missing or invalid root produces a structured refusal (`*_ROOT_REQUIRED` / `*_PROJECT_INVALID`), never a guessed path.
- `novel.project.info` returns only allow-listed metadata fields plus top-level key names; model-service configuration is never echoed.
- Shared repository carries no absolute paths (BP-1). Platform-side MCP registration is a separate per-platform decision (BP-2, D-60).
