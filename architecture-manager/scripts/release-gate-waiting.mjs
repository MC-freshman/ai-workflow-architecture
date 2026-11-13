// Derive the human-facing "waiting" list from machine state only.
// Kept in its own module so it can be unit-tested without running the gate reader.
// N6 (U-table 20261113): version comes from state.version (package.json), never hardcoded.
export function computeWaiting(state) {
  const waiting = [];
  const version = state.version || '0.0.0';
  if (state.staleManagerEvidence) waiting.push('P5d 用户终端权威 conform digest');
  if (!state.remoteConsistent) waiting.push('P6c 推送（需代理可用）');
  if (!state.docsSiteOk) waiting.push('文档站 docs-conform 判据');
  if (state.pendingTerminalRelease) waiting.push(`${version} 发布轮终端执行（P5/P6）与权威 conform（P7）`);
  return waiting;
}
