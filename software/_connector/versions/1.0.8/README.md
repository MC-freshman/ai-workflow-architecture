# Shared software connector 1.0.8

Inherits CLI, credentials and owned desktop-session behavior from 1.0.7. Adds bounded native stdio, legacy SSE and 2025 Streamable HTTP initialization, paginated tools/list and typed tools/call. Known protocols: 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25; other revisions require explicit adaptation. No 2026 protocol compatibility is claimed.

Per-tool frozen names and schemas are checked for drift before dispatch. Permissions are explicit declarations, not inferred from annotations. Platform nativeMcpServers holds endpoints, program hashes and reference-only headers/environment; nativeCredentialProvider resolves values in memory. Responses redact those values. Output schemas and isError are checked; a call failure may mean the function already ran, and is reported as uncertain. Shared current remains unchanged; adopting platform configuration is a separate confirmed plan.

Protocol references: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports and https://modelcontextprotocol.io/specification/2025-11-25/server/tools .
