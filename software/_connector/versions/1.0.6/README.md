# Shared software connector 1.0.4

This release keeps the 1.0.3 CLI, credential and desktop-session behavior and adds the missing native MCP SSE path used by Burp Suite 1.0.1. A native call verifies the installed body digest first, then opens a bounded same-origin SSE session, performs `initialize`/`notifications/initialized`, and sends one JSON-RPC `tools/list` or `tools/call`. The GUI JAR is never started as a CLI.

The connector accepts the existing `mcp-http` transport vocabulary; a recipe opts into SSE with `manifest.transport.protocol: mcp-sse`. The live tool name and input schema are read from the recipe's frozen `runtime.tools` list. A pending per-capability snapshot is refused before any network request. Every call keeps the published `ai-software-call/v1` response, idempotency index, platform-local locks and evidence layout.

The SSE session token is held only in memory for one bounded call. Redirects that change origin are refused, raw session tokens are not written to evidence, and no new error code is introduced. Older releases remain immutable.
