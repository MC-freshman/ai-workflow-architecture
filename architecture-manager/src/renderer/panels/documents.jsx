import React, { useState } from 'react';

export function DocumentPanel({ api, workspace, documentSummaries, visibleDocuments, documentFilter, setDocumentFilter, selectedDocument, documentDraft, setDocumentDraft, sensitiveConfirmed, setSensitiveConfirmed, openDocument, previewDocument, setMessage, friendlyError }) {
  const [diff, setDiff] = useState(null);
  const showDiff = async () => {
    if (!workspace || !selectedDocument) return;
    try {
      const result = await api.documentDiff({ workspaceRoot: workspace, relativePath: selectedDocument.path });
      setDiff(result);
      setMessage(result.empty ? '该文档当前没有未提交的 Git 改动。' : `已读取 ${selectedDocument.path} 的 Git 差异（只读）。`);
    } catch (error) {
      setMessage(`差异读取失败：${friendlyError(error)}`);
    }
  };
  return <section className="panel document-panel"><div className="panel-title"><span>更新日志、计划与说明文档</span><div className="panel-tools"><input className="filter-input" value={documentFilter} onChange={(event) => setDocumentFilter(event.target.value)} placeholder="搜索文件名或类型" /><span className="muted">{visibleDocuments.length}/{documentSummaries.length} 篇</span></div></div><div className="document-list">
    {visibleDocuments.map((item) => <button className="document-item" key={item.path} onClick={() => { setDiff(null); openDocument(item.path); }}><span><strong>{item.path.replace('versions/', '')}</strong><small>{item.checklistTotal ? ' · ' + item.checklistDone + '/' + item.checklistTotal + ' 项完成' : item.pItems.length ? ' · ' + item.pItems.length + ' 个 P 项' : ' · ' + item.bytes + ' 字节'}</small></span><span className="document-badges"><span className="pill">{item.kind === 'update-log' ? '更新日志' : item.kind === 'implementation-table' ? 'P表' : item.kind === 'proposal' ? '方案' : item.kind === 'ledger' ? '台账' : item.kind === 'top-level-requirements' ? '顶层要求' : '文档'}</span>{item.completionPercent != null && <span className="pill good">{item.completionPercent}%</span>}</span></button>)}
    {visibleDocuments.length === 0 && <div className="empty">{documentSummaries.length ? '没有匹配的文档。' : '选择工作区后显示更新日志、方案、P 表、台账和顶层要求。'}</div>}
  </div>{selectedDocument && <div className="editor-box"><div className="editor-heading"><strong>{selectedDocument.path}</strong><span className="muted">SHA-256 {selectedDocument.sha256.slice(0, 12)}…</span></div><textarea value={documentDraft} onChange={(event) => setDocumentDraft(event.target.value)} spellCheck={false} />{selectedDocument.sensitive && <label className="sensitive-confirm"><input type="checkbox" checked={sensitiveConfirmed} onChange={(event) => setSensitiveConfirmed(event.target.checked)} /> 我确认这是顶层治理要求的变更预览</label>}<div className="git-actions"><button className="small-button" onClick={showDiff}>查看 Git 差异</button><button className="small-button" onClick={previewDocument}>生成文档变更计划</button></div>{diff && <pre className="path-line">{diff.empty ? '（无未提交改动）' : diff.diff}</pre>}</div>}</section>;
}
