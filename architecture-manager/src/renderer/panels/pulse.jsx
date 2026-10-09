import React, { useEffect, useState } from 'react';

export function HomePulse({ api, workspace }) {
  const [pulse, setPulse] = useState(null);
  useEffect(() => {
    if (!workspace) { setPulse(null); return; }
    let active = true;
    Promise.all([
      api.readDefectBook(workspace),
      api.listRunLedger(workspace),
      api.inspectInbox(workspace),
      api.readAuditEvents({ limit: 1 })
    ]).then(([book, ledger, inbox, audit]) => {
      if (!active) return;
      setPulse({
        redRows: book.present && !book.corrupt ? book.redRows.length : null,
        defectTotal: book.present && !book.corrupt ? book.total : null,
        runs: ledger.totalRuns,
        inbox: inbox.zones.map((zone) => `${zone.zone} ${zone.entryCount}`).join(' · '),
        auditEvents: audit.present ? audit.totalEvents : null
      });
    }).catch(() => { if (active) setPulse(null); });
    return () => { active = false; };
  }, [api, workspace]);
  if (!pulse) return null;
  return <div className="stats-grid">
    <div className="stat-card"><div className="stat-label">缺陷红行</div><div className="stat-value">{pulse.redRows ?? '—'}</div><div className="stat-hint">{pulse.defectTotal != null ? `簿共 ${pulse.defectTotal} 条` : '簿未读'}</div></div>
    <div className="stat-card"><div className="stat-label">运行台账</div><div className="stat-value">{pulse.runs}</div><div className="stat-hint">六平台 run 目录</div></div>
    <div className="stat-card"><div className="stat-label">inbox</div><div className="stat-value">{pulse.inbox || '—'}</div><div className="stat-hint">只读盘点</div></div>
    <div className="stat-card"><div className="stat-label">审计事件</div><div className="stat-value">{pulse.auditEvents ?? '—'}</div><div className="stat-hint">本机应用数据</div></div>
  </div>;
}
