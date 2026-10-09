import React from 'react';

// The anchored generation: one table the workspace reads back, plus what each platform would have to
// change to line up with it. Nothing here writes: every change goes through the shared plan preview.
export function AnchorPanel({ api, workspace, report, inspectAnchor, previewAnchor, previewAnchorAlignment, busy }) {
  const anchor = report?.anchor;
  const axis = (label, value) => <span className="pill" key={label}>{label} {value || '—'}</span>;
  return <section className="panel anchor-panel">
    <div className="panel-title">
      <span>锚定代与平台对齐</span>
      <div className="panel-tools">
        <span className="muted">一个工作区一套目标版本；对齐只写平台的版本键</span>
        <button className="small-button" disabled={busy || !workspace} onClick={inspectAnchor}>读取锚定代</button>
        <button className="small-button" disabled={busy || !workspace || !anchor} onClick={previewAnchor}>生成锚定件</button>
      </div>
    </div>
    {!workspace && <div className="empty">选择工作区后显示锚定代。</div>}
    {workspace && !report && <div className="empty">尚未读取。点“读取锚定代”查看目标版本与该工作区各平台的差异。</div>}
    {report?.refusal && <div className="notice">
      <strong>锚定代尚不可用：{report.refusal.code}</strong>
      <p>没有合格的目标代就不能对齐任何平台；下面列出每个候选版本自己的落选原因。</p>
      <div className="marker-list">{(report.refusal.rejected || []).map((row) => <span className="marker missing" key={`${row.axis}:${row.version}`}>{row.axis} {row.version} · {row.reason}</span>)}</div>
    </div>}
    {anchor && <>
      <div className="rows anchor-axes">
        {axis('引擎', anchor.engine?.version)}{axis('契约', anchor.contracts?.version)}{axis('检查器', anchor.checker?.version)}
        {axis('调用判据', anchor.judge?.version)}{axis('能力判据', anchor.conformance?.version)}
        {axis('连接器', anchor.software?.connector)}{axis('网关', anchor.software?.gateway)}
        {axis('配方', String(anchor.software?.recipes?.length ?? 0))}
      </div>
      <div className="plan-meta">
        <span>锚定件：{report.materialised ? `已落盘 · ${String(report.materialisedDigest).slice(0, 12)}…` : '尚未落盘'}</span>
        <span className={report.materialised && report.matchesComputed === false ? 'pill warn' : 'pill'}>{report.materialised ? (report.matchesComputed === false ? '与当前工作区不一致，需重新生成' : '与当前工作区一致') : '待生成'}</span>
        <span className="muted">规则：{anchor.selectionRule}</span>
      </div>
      <details className="platform-gaps"><summary>查看落选账本（{anchor.rejected?.length || 0} 条）</summary>
        {(anchor.rejected || []).map((row) => <p key={`${row.axis}:${row.version}`}><strong>{row.axis} {row.version}</strong> · {row.reason}</p>)}
      </details>
      <div className="rows">
        {(report.platforms || []).map((row) => <div className="row" key={row.platformId}>
          <div className="platform-main">
            <span className="row-name">{row.platformId}</span>
            {row.ok === false && <div className="path-line">无法比较：{row.error}</div>}
            {row.ok && row.anchor.materialised === false && <div className="path-line">锚定件尚未落盘，本平台还没有被比较过。</div>}
            {row.ok && row.anchor.materialised !== false && row.anchor.aligned && <div className="path-line">已与锚定代一致。</div>}
            {row.ok && row.anchor.materialised !== false && !row.anchor.aligned && <div className="marker-list">{row.anchor.differences.map((difference) => <span className="marker missing" key={difference.key}>{difference.key}：{String(difference.current)} → {difference.expected}</span>)}</div>}
            {row.ok && row.anchor.warnings?.map((warning) => <p key={warning} className="muted">{warning}</p>)}
          </div>
          <div className="resource-actions">
            <span className={row.ok && row.anchor.aligned ? 'pill good' : row.ok ? 'pill warn' : 'pill'}>{row.ok ? (row.anchor.materialised === false ? '锚定件未生成' : row.anchor.aligned ? '已在锚定代上' : `${row.anchor.differences.length} 处待对齐`) : '待处理'}</span>
            <button className="small-button" disabled={busy || !row.ok || !report.materialised || row.anchor.aligned} onClick={() => previewAnchorAlignment(row.platformId)}>预览对齐</button>
            <small className="muted">软件：网关{row.software?.gatewayDeclared ? '已声明' : '未声明'} · 运行位{row.software?.runtimeDeclared ? '已声明' : '未声明'} · 环境{row.software?.environmentDeclared ? '已声明' : '未声明'}</small>
          </div>
        </div>)}
      </div>
    </>}
  </section>;
}
