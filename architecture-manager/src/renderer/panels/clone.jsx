import React, { useState } from 'react';

export function ClonePanel({ api, onCloned, setMessage, friendlyError }) {
  const [remote, setRemote] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const pickDestination = async () => {
    const selected = await api.selectDirectory();
    if (selected) setDestination(selected);
  };
  const clone = async () => {
    if (!remote || !destination) { setMessage('请填写仓库远端与目标目录。'); return; }
    if (!window.confirm(`确认克隆 ${remote} 到 ${destination}？\n\n这是创建全新工作区的授权动作；失败会清理半成品。`)) return;
    setBusy(true);
    try {
      const plan = await api.previewWorkspaceClonePlan({ remote, destination, confirmed: true });
      const applied = await api.applyWorkspaceClone({ plan });
      setMessage(`克隆完成（HEAD ${applied.head.slice(0, 12)}…），已切换到新工作区并开始首次扫描。`);
      onCloned(applied.destination);
    } catch (error) {
      setMessage(`克隆失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return <section className="panel"><div className="panel-title"><span>从 0 搭建：克隆架构仓</span><span className="muted">装好管理台 → 克隆 → 接入平台 → 开工</span></div>
    <div className="integration-form">
      <label>架构仓远端（https / git@ / 本地路径）<input value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://github.com/…/ai-workflow-architecture-governance.git" /></label>
      <label>本机目标目录（须为空）<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="D:\my-ai" /></label>
    </div>
    <div className="git-actions">
      <button className="small-button" onClick={pickDestination}>选择目录</button>
      <button className="small-button primary-small" onClick={clone} disabled={busy || !remote || !destination}>{busy ? '克隆中…' : '生成克隆计划并执行'}</button>
    </div>
    <div className="muted">克隆后自动校验架构标记（versions/tool/agent/software/AGENTS.md）；平台接入用下方接入向导完成。</div>
  </section>;
}
