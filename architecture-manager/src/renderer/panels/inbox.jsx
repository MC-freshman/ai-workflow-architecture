import React, { useEffect, useState } from 'react';

export function InboxPanel({ api, workspace }) {
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState(null);
  const load = () => {
    if (!workspace) return;
    setError(null);
    api.inspectInbox(workspace).then((data) => setInbox(data)).catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(() => {
    setInbox(null);
    load();
  }, [workspace]);
  return <section className="panel"><div className="panel-title"><span>inbox 盘点（纯只读）</span><div className="panel-tools"><span className="muted">BP-7：不自动发现 · 不执行 · 不删除</span><button className="small-button" onClick={load} disabled={!workspace}>刷新</button></div></div>
    {error && <div className="empty">读取失败：{error}</div>}
    {!inbox && !error && <div className="empty">选择工作区后显示三个分区。</div>}
    {inbox && <div>
      {inbox.bp7Ledger && <div className="muted">BP-7 备份账：{inbox.bp7Ledger.present ? (inbox.bp7Ledger.corrupt ? '存在但不可读' : `${inbox.bp7Ledger.entryCount} 条登记（${inbox.bp7Ledger.generatedAt || '时间未知'}）`) : '未找到'}</div>}
      {inbox.zones.map((zone) => <div key={zone.zone}>
        <div className="panel-subtitle">{zone.zone} · {zone.present ? `${zone.entryCount} 项` : '分区不存在'}</div>
        {zone.present && zone.entries.length > 0 && <div className="rows">{zone.entries.map((entry) => <div className="row" key={entry.name}>
          <div><span className="row-name">{entry.name}</span><div className="path-line">{entry.kind === 'directory' ? '目录' : '文件'}</div></div>
        </div>)}</div>}
        {zone.present && zone.entries.length === 0 && <div className="empty">空分区。</div>}
      </div>)}
    </div>}
  </section>;
}
