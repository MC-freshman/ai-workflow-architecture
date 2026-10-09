import {parseJson as parseJsonText} from './json.mjs';
// Decode complete JSONL events across arbitrary pipe chunk boundaries.
export function matrixProgressDecoder(platformId, onProgress) {
  let pending = '';
  return (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    if (pending.length > 65536) pending = '';
    for (const line of lines) {
      let event; try { event = parseJsonText(line); } catch { continue; }
      if (event.schema !== 'ai-invocation-matrix-event/v1' || !Number.isInteger(event.completed) || event.completed < 0 || !Number.isInteger(event.total) || event.total < 0) continue;
      const row = event.row;
      const verdict = { PASS: '通过', FAIL: '失败', EXPECTED: '登记例外', 'NEEDS-INPUT': '需要输入' }[row?.status];
      onProgress({ platformId, phase: row ? `调用格 ${row.kind || '选择'}:${row.id} · ${verdict || row.status}` : '开始调用矩阵', completed: event.completed, total: event.total, row, elapsedMs: event.elapsedMs, durationMs: row?.durationMs, timings:row?.timings || null,remainingEstimateMs:event.completed>0 && Number.isFinite(event.elapsedMs)?Math.max(0,event.elapsedMs/event.completed*(event.total-event.completed)):null });
    }
  };
}
