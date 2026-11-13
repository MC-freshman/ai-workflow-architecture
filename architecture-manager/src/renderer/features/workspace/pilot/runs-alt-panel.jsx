// P4 pilot replacement panel: self-written minimal runs ledger UI.
// Same query channel (runs:ledger) and same data contract as panels/runs.jsx;
// rendering code is independent. Enabled only via module-overrides.json
// {"panel-runs": {"replacement": "panel-runs-alt"}} after contract tests pass.
import React, { useEffect, useState } from 'react';
import { ALT_LOCK_BADGE, ALT_LOCK_TEXT } from './runs-alt-core.mjs';

export function RunsAltPanel({ api, workspace }) {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setLedger(null);
    setError(null);
    if (!workspace) return undefined;
    api.listRunLedger(workspace)
      .then((value) => { if (alive) setLedger(value); })
      .catch((err) => { if (alive) setError(String(err?.message || err)); });
    return () => { alive = false; };
  }, [api, workspace]);

  if (!workspace) return <div className="panel"><div className="panel-title">运行台账（替代实现 · 试点）</div><p>先选择工作区。</p></div>;
  if (error) return <div className="panel"><div className="panel-title">运行台账（替代实现 · 试点）</div><p className="pill bad">{error}</p></div>;
  if (!ledger) return <div className="panel"><div className="panel-title">运行台账（替代实现 · 试点）</div><p>读取中…</p></div>;
  return (
    <div className="panel">
      <div className="panel-title">
        <span>运行台账（替代实现 · 试点）</span>
        <span className="pill good">共 {ledger.totalRuns} 个 run</span>
      </div>
      {ledger.platforms.filter((p) => p.runsRootPresent).map((p) => (
        <div key={p.platform} className="panel-subsection">
          <div className="panel-subtitle">{p.platform} · {p.total}</div>
          <table className="table">
            <thead><tr><th>run</th><th>锁</th><th>工作流</th><th>专家</th><th>阶段</th></tr></thead>
            <tbody>
              {p.runs.map((run) => (
                <tr key={run.runRoot}>
                  <td><code>{run.runRoot.split(/[\\/]/).pop()}</code></td>
                  <td><span className={ALT_LOCK_BADGE[run.lockStatus] || 'pill warn'}>{ALT_LOCK_TEXT[run.lockStatus] || run.lockStatus}</span></td>
                  <td>{run.selection?.workflow ?? '—'}</td>
                  <td>{run.selection?.agent ?? '—'}</td>
                  <td>{run.execution?.stageCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}