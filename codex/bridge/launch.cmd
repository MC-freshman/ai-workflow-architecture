@echo off
setlocal
set "AI_ROOT=E:\ai"
set "AI_PLATFORM=codex"
set "AI_AGENT_ROOT=%AI_ROOT%\agent"
set "AI_TOOL_ROOT=%AI_ROOT%\tool"
set "AI_RUNTIME_ROOT=%AI_ROOT%\codex\runtime"
set "AI_ARCHITECTURE_SYSTEM_PROMPT=%AI_ROOT%\AI_ARCHITECTURE_SYSTEM_PROMPT.md"
set "CODEX_HOME=%AI_ROOT%\codex\chatgpt\userdata\codex-home"
set "XDG_CACHE_HOME=%AI_ROOT%\codex\chatgpt\userdata\cache"
set "TEMP=%AI_ROOT%\codex\runtime\tmp"
set "TMP=%AI_ROOT%\codex\runtime\tmp"
if not exist "%AI_RUNTIME_ROOT%\tmp" mkdir "%AI_RUNTIME_ROOT%\tmp"
if not exist "%AI_ROOT%\codex\chatgpt\userdata\cache" mkdir "%AI_ROOT%\codex\chatgpt\userdata\cache"
set "AI_NODE=%AI_ROOT%\codex\chatgpt\app\resources\cua_node\bin\node.exe"
if not exist "%AI_NODE%" set "AI_NODE=node.exe"
"%AI_NODE%" "%AI_ROOT%\codex\bridge\server.mjs"
exit /b %errorlevel%
