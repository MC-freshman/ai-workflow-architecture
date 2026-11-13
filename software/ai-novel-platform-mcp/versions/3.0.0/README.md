# AI Novel Platform MCP (v3 full coverage)

Zero-dependency stdio MCP (Node >= 20), 20 tools. Full headless takeover of AI Novel Writing Platform project data: 9 core file reads, explicit-whitelist service calls, and confirmed write tools.

## Start

```bash
node <release>/src/server.mjs
```

Roots are injected by the platform (never hardcoded here): `NOVEL_PROJECT_ROOT, NOVEL_APP_ROOT`.

## Tool groups

| group | tools |
|---|---|
| core read | novel_project_info, novel_chapter_list, novel_chapter_read, novel_character_list, novel_world_list, novel_knowledge_status, novel_analysis_state, novel_project_tree, novel_config_keys, novel_capabilities, novel_call, novel_state, novel_knowledge_search, novel_analysis_timeline, novel_analysis_consistency, novel_story_overview, novel_plan |
| write (confirmed) | novel_chapter_write, novel_backup_create, novel_knowledge_rebuild, novel_apply |

## Boundaries

- Read tools are open; injected tools return `CAPABILITY_UNAVAILABLE:<tool>` with a remediation path when roots are missing.
- `*_call` only accepts functions in the explicit whitelist; write functions are reachable solely through confirmed write tools.
- Write tools require `*.plan` then `planId` + `confirmToken` (5 min, one-shot, hash-checked); replay/tool drift gives `PLAN_DRIFT`.
- All responses pass `redact()`; `novel.config` returns allow-listed fields only.
- Shared repository carries no absolute paths (BP-1). GUI driving, cloud model calls, git push and publishing are out of scope by red line.
