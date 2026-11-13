# AI Novel Platform MCP (v3.1 mindmap + grid)

Zero-dependency stdio MCP (Node >= 20), 31 tools. Full headless takeover of AI Novel Writing Platform project data, plus first-class mind map building for the 0.3.9 planning boards.

## Start

```bash
node <release>/src/server.mjs
```

Roots are injected by the platform (never hardcoded here): `NOVEL_PROJECT_ROOT`, `NOVEL_APP_ROOT`.
Optional `NOVEL_XMIND_IMPORT_ROOT` restricts which local `.xmind` files `novel_mindmap_import_xmind` may read.

## Tool groups

| group | tools |
|---|---|
| core read | novel_project_info, novel_chapter_list, novel_chapter_read, novel_character_list, novel_world_list, novel_knowledge_status, novel_analysis_state, novel_project_tree, novel_config_keys, novel_capabilities, novel_call, novel_state, novel_knowledge_search, novel_analysis_timeline, novel_analysis_consistency, novel_story_overview, novel_plan |
| planning read | novel_mindmap_list, novel_mindmap_get, novel_grid_list, novel_grid_get |
| mindmap write (confirmed) | novel_mindmap_create, novel_mindmap_add_nodes, novel_mindmap_update_node, novel_mindmap_delete_node, novel_mindmap_delete, novel_mindmap_import_xmind |
| other write (confirmed) | novel_chapter_write, novel_backup_create, novel_knowledge_rebuild, novel_apply |

## Build a mind map from an outline

`novel_mindmap_create` accepts `title`, `root` and `outline`. The outline is either a nested array
(`[{ "text": "角色", "note": "", "children": [{ "text": "主角" }] }]`) or indented text:

```
角色
  主角 :: 第一章登场
  反派
剧情
  开幕
  转折
```

`" :: "` separates a note from the topic text. First-level branches alternate left/right; deeper
nodes inherit their branch side. Pass `id` or `title` to address an existing map in the other tools,
`parentId` to choose where to append, and `nodeId` (from `novel_mindmap_get`) to edit or delete a node.

`novel_mindmap_import_xmind` reads a local `.xmind` (new `content.json` or XMind 8 `content.xml`),
previews every sheet as one map, and writes them through the same service the desktop app uses.
Set `sheetIndex` to import just one sheet.

## Confirmed writes

All six mindmap write tools require `novel_plan` first:

1. `novel_plan` with `{ "tool": "novel_mindmap_create", "arguments": { ... } }` -> `planId`, `confirmToken`.
2. Call the tool with the identical arguments plus `planId` and `confirmToken`.
3. The token is one-shot, expires in 5 minutes, and drifts if tool or arguments change.

Writes go through `creative-workspace.cjs#upsertItem` / `#deleteItem`, so capacity limits,
normalization, atomic file replacement and project transactions are identical to the desktop app.

## Boundaries

- Read tools are open; injected tools return `CAPABILITY_UNAVAILABLE:<tool>` with a remediation path when roots are missing.
- `*_call` only accepts functions in the explicit whitelist; write functions are reachable solely through confirmed write tools.
- All responses pass `redact()`; `novel.config` returns allow-listed fields only.
- Shared repository carries no absolute paths (BP-1). GUI driving, cloud model calls, git push and publishing are out of scope by red line.
- A running desktop app keeps its own in-memory draft. After an external MCP write, use the in-app
  `刷新规划数据` control on the planning page, then reopen the map from the list. Do not edit the same
  map in both clients at once.

## Concurrency and exclusive resources

`instanceMode: per-run`, `poolSize: null`, `exclusiveResources: []`, `whenBusy: reject-retryable`.
The server holds confirmation plans in process memory only. The desktop app can overwrite an
externally written map from its own unsaved draft; treat the project directory as a single-writer
resource when both clients are open.
