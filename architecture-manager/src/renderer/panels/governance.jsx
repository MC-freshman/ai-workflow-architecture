import React, { useEffect, useState } from 'react';

const STATUSES = ['open', 'closed', 'absorbed', 'ruled', 'unverified-registration'];
const RED = new Set(['open', 'unverified-registration']);

export function GovernancePanel({ api, workspace, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const [check, setCheck] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [showAppend, setShowAppend] = useState(false);
  const [draft, setDraft] = useState({ id: '', title: '', status: 'open', location: '', source: '' });
  const load = () => {
    if (!workspace) return;
    setError(null);
    api.readDefectBook(workspace).then((data) => setBook(data)).catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(() => {
    setBook(null);
    setCheck(null);
    setEditingId(null);
    setShowAppend(false);
    load();
  }, [workspace]);
  const runChecker = () => {
    if (!workspace) return;
    setMessage('正在运行缺陷簿机检（只读）……');
    api.verifyDefectBook(workspace).then((result) => {
      setCheck(result);
      setMessage(result.passed ? '缺陷簿机检通过（exit 0）。' : `缺陷簿机检未通过（exit ${result.exitCode}），见输出。`);
    }).catch((e) => setMessage(`机检运行失败：${friendlyError(e)}`));
  };
  const previewStatusChange = async () => {
    try {
      const plan = await api.previewDefectBookEditPlan({ workspaceRoot: workspace, operation: 'set-status', rowId: editingId, newStatus, baselineSha256: book.sha256 });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成缺陷簿状态变更计划：${plan.target.description}。尚未写入。`);
    } catch (e) {
      setMessage(`缺陷簿计划被拒绝：${friendlyError(e)}`);
    }
  };
  const previewAppend = async () => {
    try {
      const plan = await api.previewDefectBookEditPlan({ workspaceRoot: workspace, operation: 'append', row: draft, baselineSha256: book.sha256 });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成缺陷登记计划：${plan.target.description}。尚未写入。`);
    } catch (e) {
      setMessage(`缺陷簿计划被拒绝：${friendlyError(e)}`);
    }
  };
  return <section className="panel"><div className="panel-title"><span>治理 · 缺陷状态簿（登记走计划层）</span><div className="panel-tools"><span className="muted">{book && book.present && !book.corrupt ? `共 ${book.total} 条 · 红行 ${book.redRows.length}` : '未读取'}</span><button className="small-button" onClick={load} disabled={!workspace}>刷新</button><button className="small-button" onClick={runChecker} disabled={!workspace}>运行机检</button></div></div>
    {error && <div className="empty">读取失败：{error}</div>}
    {!book && !error && <div className="empty">选择工作区后读取 versions/缺陷状态簿.json。</div>}
    {book && book.corrupt && <div className="empty">缺陷簿不是合法 JSON，登记已阻止。</div>}
    {book && book.present && !book.corrupt && <div>
      <div className="git-summary">{STATUSES.map((status) => <div key={status}><span className={RED.has(status) && book.counts[status] > 0 ? 'pill warn' : 'muted'}>{status}</span><span> {book.counts[status] || 0}</span></div>)}</div>
      {book.redRows.length > 0 && <div className="scan-result warning">红行点名：{book.redRows.map((row) => row.id).join('、')}</div>}
      {check && <div className={check.passed ? 'scan-result clean' : 'scan-result warning'}>机检 {check.passed ? '通过' : `未通过（exit ${check.exitCode}）`}{check.output ? <pre className="path-line">{check.output.slice(-400)}</pre> : null}</div>}
      <div className="rows resource-rows">
        {book.rows.map((row) => <div className="row" key={row.id || row.title}>
          <div>
            <span className="row-name">{row.id}</span>
            <span className={RED.has(row.status) ? 'pill warn' : 'pill good'}>{row.status}</span>
            <div className="path-line">{row.title}</div>
          </div>
          <div className="resource-actions">
            {editingId === row.id
              ? <><select className="version-select" value={newStatus} onChange={(event) => setNewStatus(event.target.value)}><option value="">新状态</option>{STATUSES.filter((status) => status !== row.status).map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="small-button" disabled={!newStatus} onClick={previewStatusChange}>生成变更计划</button><button className="small-button" onClick={() => { setEditingId(null); setNewStatus(''); }}>取消</button></>
              : <button className="small-button" onClick={() => { setEditingId(row.id); setNewStatus(''); setShowAppend(false); }}>变更状态</button>}
          </div>
        </div>)}
      </div>
      <div className="git-actions">
        <button className="small-button" onClick={() => { setShowAppend((value) => !value); setEditingId(null); }}>{showAppend ? '收起登记表单' : '登记新缺陷'}</button>
      </div>
      {showAppend && <div className="editor-box">
        {['id', 'title', 'location', 'source'].map((field) => <div key={field}><label className="muted">{field}</label><input className="filter-input" value={draft[field]} onChange={(event) => setDraft((state) => ({ ...state, [field]: event.target.value }))} placeholder={field} /></div>)}
        <div><label className="muted">status</label><select className="version-select" value={draft.status} onChange={(event) => setDraft((state) => ({ ...state, status: event.target.value }))}>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>
        <button className="small-button" onClick={previewAppend}>生成登记计划</button>
        <div className="muted">登记与状态变更都只生成计划；确认前不写任何文件。</div>
      </div>}
    </div>}
  </section>;
}
