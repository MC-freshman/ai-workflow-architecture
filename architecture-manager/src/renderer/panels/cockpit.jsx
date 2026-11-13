// N1 governance cockpit panel (approved U-table 20261113): read-only aggregation of recorded
// gate evidence. Every block shows its recordedAt; missing evidence renders as 未记录, never green.
import React, { useEffect, useState } from 'react';

const okPill = (ok) => (ok === true ? 'pill good' : ok === false ? 'pill bad' : 'pill warn');

export function CockpitPanel({ api, workspace }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api.getGateCockpit({ workspaceRoot: workspace || undefined })
      .then((value) => { if (alive) setData(value); })
      .catch((err) => { if (alive) setError(String(err?.message || err)); });
    return () => { alive = false; };
  }, [api, workspace]);

  if (error) return <section className="panel"><div className="panel-title">治理驾驶舱（只读）</div><p className="pill bad">{error}</p></section>;
  if (!data) return <section className="panel"><div className="panel-title">治理驾驶舱（只读）</div><p>读取中…</p></section>;
  const c = data.conform;
  return (
    <section className="panel">
      <div className="panel-title">
        <span>治理驾驶舱（只读 · 证据非实时）</span>
        <button className="small-button" onClick={() => { setData(null); api.getGateCockpit({ workspaceRoot: workspace || undefined }).then(setData).catch((e) => setError(String(e?.message || e))); }}>刷新证据</button>
      </div>
      <div className="panel-grid">
        <div className="panel">
          <div className="panel-subtitle">conform 门禁</div>
          {c ? <>
            <p><span className={okPill(c.ok)}>{c.ok === true ? '五段全绿' : c.ok === false ? '存在红段' : '未记录'}</span> <span className={c.sourcesDrifted === true ? 'pill bad' : c.sourcesDrifted === false ? 'pill good' : 'pill warn'}>{c.sourcesDrifted === true ? '源快照漂移' : c.sourcesDrifted === false ? '源快照一致' : '快照不可比'}</span></p>
            <p className="path-line">digest <code>{(c.digest || '').slice(0, 16)}…</code></p>
            <p className="path-line">记录于 {c.recordedAt || '未记录'} · sourceStable {String(c.sourceStable)}</p>
            {c.tests ? <p className="path-line">tests {c.tests.tests} / pass {c.tests.pass} / fail {c.tests.fail} / skip {c.tests.skipped}</p> : null}
            <p className="path-line">{(c.steps || []).map((s) => `${s.name}:${s.ok ? '✓' : '✗'}`).join(' · ')}</p>
          </> : <p className="pill warn">未记录（须用户终端跑 npm run conform）</p>}
        </div>
        <div className="panel">
          <div className="panel-subtitle">MCP 绑定</div>
          <p><span className="pill good">manager {data.mcpBinding.manager.count} 导出</span> {data.mcpBinding.novelSkipped ? <span className="pill warn">novel 半 skip（无 NOVEL_APP_ROOT）</span> : <span className="pill good">novel {data.mcpBinding.novel?.count} 文件</span>}</p>
          <p className="path-line">基线 sha <code>{data.mcpBinding.manager.sha256.slice(0, 16)}…</code>（漂移由 test 段机检）</p>
        </div>
        <div className="panel">
          <div className="panel-subtitle">供应链（最近证据）</div>
          {data.supplyChain.sbom ? <p><span className="pill good">SBOM {data.supplyChain.sbom.components} 组件</span> <span className="path-line">{data.supplyChain.sbom.bomFormat} {data.supplyChain.sbom.specVersion}</span></p> : <p className="pill warn">SBOM 未记录</p>}
          {data.supplyChain.audit ? <p><span className={(data.supplyChain.audit.counts?.high || 0) + (data.supplyChain.audit.counts?.critical || 0) > 0 ? 'pill bad' : (data.supplyChain.audit.counts?.moderate || 0) > 0 ? 'pill warn' : 'pill good'}>audit {JSON.stringify(data.supplyChain.audit.counts)}</span> <span className="path-line">{data.supplyChain.audit.names.join(', ') || '无'}</span></p> : <p className="pill warn">audit 未记录（或离线 skip）</p>}
        </div>
        <div className="panel">
          <div className="panel-subtitle">缺陷与模块</div>
          <p><span className={data.defects.redRows?.length ? 'pill warn' : 'pill good'}>红行 {data.defects.redRows?.length ?? 0}</span> <span className="path-line">共 {data.defects.total ?? '未记录'} 条</span></p>
          <p className="path-line">{(data.defects.redRows || []).map((r) => r.id).join(', ') || '无红行'}</p>
          {data.registry ? <p className="path-line">注册表 {data.registry.summary.moduleCount} 模块 / {data.registry.summary.channelCount} 通道 · overrides {Object.keys(data.registry.overrides || {}).length} 项</p> : <p className="pill warn">注册表未记录</p>}
        </div>
      </div>
      <p className="path-line">{data.notes.join(' ')}</p>
    </section>
  );
}