// N3 pilot replacement panel: self-written minimal audit history UI.
// Same query channel (audit:events) and data contract as panels/audit.jsx; rendering independent.
// Enabled only via module-overrides.json {"panel-audit": {"replacement": "panel-audit-alt"}}
// after contract tests pass (docs/module-replacement.md).
import React, { useEffect, useState } from 'react';

export function AuditAltPanel({ api, workspace }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.readAuditEvents({ limit: 100, workspaceRoot: workspace || null, verifyCheckpoints: true })
      .then((value) => { if (alive) setData(value); })
      .catch((err) => { if (alive) setError(String(err?.message || err)); });
    return () => { alive = false; };
  }, [api, workspace]);
  if (error) return <section className="panel"><div className="panel-title">审计历史（替代实现 · 试点）</div><p className="pill bad">{error}</p></section>;
  if (!data) return <section className="panel"><div className="panel-title">审计历史（替代实现 · 试点）</div><p>读取中…</p></section>;
  return (
    <section className="panel">
      <div className="panel-title">
        <span>审计历史（替代实现 · 试点）</span>
        <span className={data.integrity?.mismatches ? 'pill bad' : 'pill good'}>封条不符 {data.integrity?.mismatches ?? 0}</span>
      </div>
      <p className="path-line">全部 {data.totalEvents} 条 · 筛选 {data.matchedEvents} 条 · 坏行 {data.corruptLines} · 未封条 {data.integrity?.legacyUnsealed ?? 0}</p>
      <div className="rows">
        {(data.events || []).slice().reverse().map((event, index) => (
          <div className="row" key={`${event.transactionId || 'legacy'}:${event.occurredAt || ''}:${index}`}>
            <div>
              <span className="row-name">{event.action}</span>
              <span className={['applied', 'completed', 'already-applied'].includes(event.status) ? 'pill good' : 'pill warn'}>{event.status}</span>
              <div className="path-line">{event.occurredAt || '时间未记录'} · 计划 {event.planId || '未记录'}</div>
            </div>
            <span className="pill">{event.integrity?.checksum || ''}</span>
          </div>
        ))}
      </div>
    </section>
  );
}