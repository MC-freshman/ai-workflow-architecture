import React, { useEffect, useState } from 'react';

const LOCK_BADGE = { ok: 'pill good', missing: 'pill warn', corrupt: 'pill warn', 'unknown-schema': 'pill warn' };
const LOCK_TEXT = { ok: '锁可读', missing: '无锁文件', corrupt: '锁损坏', 'unknown-schema': '未知锁形态' };

function isMaintenanceRun(run) {
  return run.lockStatus === 'ok' && run.selection && run.selection.workflow === null && run.selection.agent === null;
}

export function RunsPanel({ api, workspace }) {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState(null);
  const load = () => {
    if (!workspace) return;
    setError(null);
    api.listRunLedger(workspace).then((data) => setLedger(data)).catch((error) => setError(String(error?.message ?? error)));
  };
  useEffect(() => {
    setLedger(null);
    load();
  }, [workspace]);
  const platforms = (ledger?.platforms || []).filter((platform) => platform.total > 0);
  return <section className="panel"><div className="panel-title"><span>运行台账（只读）</span><div className="panel-tools"><span className="muted">{ledger ? `共 ${ledger.totalRuns} 个 run · 不写入任何平台 runtime` : '未读取'}</span><button className="small-button" onClick={load} disabled={!workspace}>刷新</button></div></div>
    {error && <div className="empty">读取失败：{error}</div>}
    {!ledger && !error && <div className="empty">选择工作区后显示六平台 run 目录。</div>}
    {platforms.length === 0 && ledger && <div className="empty">六个平台当前都没有 run 目录。</div>}
    {platforms.map((platform) => <div key={platform.platform}>
      <div className="panel-subtitle">{platform.platform} · {platform.total} 个 run</div>
      <div className="rows">{platform.runs.map((run) => {
        const name = run.runRoot.split(/[\\/]/).filter(Boolean).pop();
        const maintenance = isMaintenanceRun(run);
        return <div className="row" key={run.runRoot}>
          <div>
            <span className="row-name">{name}</span>
            {maintenance ? <span className="pill">维护登记 · 不可恢复为业务 run</span> : null}
            <div className="path-line">{run.lockStatus === 'ok' ? `${run.schemaVersion} · ${run.selection?.workflow || run.selection?.agent || '—'} · 档位 ${run.execution?.rigor || '未记'}${run.execution?.frozen ? ' · 已冻结' : ''} · ${run.resourceCount} 项资源` : LOCK_TEXT[run.lockStatus] + (run.lockStatus === 'unknown-schema' && run.schemaVersion ? `（${run.schemaVersion}）` : '')}</div>
          </div>
          <div className="resource-actions"><span className={LOCK_BADGE[run.lockStatus] || 'pill'}>{LOCK_TEXT[run.lockStatus] || run.lockStatus}</span></div>
        </div>;
      })}</div>
    </div>)}
  </section>;
}
