// P5 run timeline panel (approved P-table 20261111): read-only stage timeline + hash-chained
// run events + manager audit events linked via transactionId/planId. No writes anywhere.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRefreshController } from '../shared/refresh-controller.mjs';

const STAGE_PILL = { completed: 'pill good', active: 'pill warn', pending: 'pill' };
const STAGE_TEXT = { completed: '已完成', active: '进行中', pending: '待执行' };

export function RunTimelinePanel({ api, workspace }) {
  const [ledger, setLedger] = useState(null);
  const [platformId, setPlatformId] = useState('');
  const [runId, setRunId] = useState('');
  const [planId, setPlanId] = useState('');
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    let alive = true;
    setLedger(null);
    if (!workspace) return undefined;
    api.listRunLedger(workspace)
      .then((value) => { if (alive) setLedger(value); })
      .catch((err) => { if (alive) setError(String(err?.message || err)); });
    return () => { alive = false; };
  }, [api, workspace]);

  const platforms = useMemo(() => (ledger?.platforms || []).filter((p) => p.runsRootPresent && p.total > 0), [ledger]);
  const runs = useMemo(() => platforms.find((p) => p.platform === platformId)?.runs || [], [platforms, platformId]);

  const loadDetail = () => {
    const version = ++request.current;
    setError(null);
    if (!workspace || !platformId || !runId) { setDetail(null); return; }
    api.getRunDetail({ workspaceRoot: workspace, platformId, runId, planId: planId || undefined })
      .then((value) => { if (version === request.current) setDetail(value); })
      .catch((err) => { if (version === request.current) setError(String(err?.message || err)); });
  };
  useEffect(() => {
    setDetail(null);
    loadDetail();
    return () => { request.current++; };
  }, [api, workspace, platformId, runId, planId]);
  useEffect(() => {
    if (!auto) return undefined;
    const controller = createRefreshController({ load: loadDetail });
    controller.setEnabled(true);
    return () => controller.stop();
  }, [auto, api, workspace, platformId, runId, planId]);

  if (!workspace) return <div className="panel"><div className="panel-title">run 时间线（只读）</div><p>先选择工作区。</p></div>;
  return (
    <div className="panel">
      <div className="panel-title">
        <span>run 时间线（只读）</span>
        {detail ? <span className={detail.eventChain === 'ok' ? 'pill good' : 'pill bad'}>{detail.eventChain === 'ok' ? '事件链衔接完整' : '事件链衔接断裂'}</span> : null}
      </div>
      <div className="panel-tools" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select value={platformId} onChange={(e) => { setPlatformId(e.target.value); setRunId(''); }} aria-label="平台">
          <option value="">选择平台</option>
          {platforms.map((p) => <option key={p.platform} value={p.platform}>{p.platform} · {p.total}</option>)}
        </select>
        <select value={runId} onChange={(e) => setRunId(e.target.value)} aria-label="run">
          <option value="">选择 run</option>
          {runs.map((r) => <option key={r.runRoot} value={r.runRoot.split(/[\\/]/).pop()}>{r.runRoot.split(/[\\/]/).pop()}</option>)}
        </select>
        <input value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="planId 过滤（可选）" aria-label="planId 过滤" />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />自动刷新（30s，默认关）
        </label>
      </div>
      {error ? <p className="pill bad">{error}</p> : null}
      {detail?.error ? <p className="pill bad">{detail.error}</p> : null}
      {detail && !detail.error ? (
        <>
          <div className="panel-subtitle">阶段（{detail.stages.length}）</div>
          <div className="timeline-stages">
            {detail.stages.map((stage) => (
              <div className="timeline-stage" key={stage.id}>
                <span className={STAGE_PILL[stage.status] || 'pill'}>{STAGE_TEXT[stage.status] || stage.status}</span>
                <code>{stage.id}</code>
                <span className="muted">{stage.action || ''}{stage.attempts ? ` · ${stage.attempts} 次` : ''}</span>
                {stage.gates.length ? <span className="muted">门禁 {stage.gates.map((g) => g.gateId).join(', ')}</span> : null}
              </div>
            ))}
            {detail.stages.length === 0 ? <p className="muted">锁内无阶段定义。</p> : null}
          </div>
          <div className="panel-subtitle">run 事件（{detail.events.length}{detail.corruptLines ? ` · 坏行 ${detail.corruptLines}` : ''}）</div>
          <div className="timeline-events">
            {detail.events.slice(-60).map((event) => (
              <div className="timeline-event" key={event.sequence ?? event.at}>
                <code>#{event.sequence ?? '—'}</code>
                <span className={event.status === 'succeeded' || event.status === 'completed' ? 'pill good' : 'pill'}>{event.type || event.status}</span>
                <span className="muted">{event.at || ''}</span>
                {event.sealed ? <span className="pill good">封条</span> : <span className="pill warn">无封条</span>}
              </div>
            ))}
          </div>
          <div className="panel-subtitle">管理台审计关联（transactionId/planId · {detail.audit.linked.length}/{detail.audit.totalEvents}）</div>
          {detail.audit.linked.length === 0 ? <p className="muted">无关联审计事件（该 run 非管理台事务驱动，或 planId 未匹配）。</p> : (
            <div className="timeline-events">
              {detail.audit.linked.map((event, i) => (
                <div className="timeline-event" key={i}>
                  <span className={event.status === 'succeeded' ? 'pill good' : 'pill warn'}>{event.action}</span>
                  <span className="muted">{event.occurredAt || ''}</span>
                  <span className="pill">{event.integrity?.checksum || ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}