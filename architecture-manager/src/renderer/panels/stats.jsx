import React from 'react';

export function Stat({ label, value, hint }) {
  return <div className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

export function DashboardStats({ inventory, gitState }) {
  return <div className="stats-grid">
    <Stat label="平台" value={inventory?.platforms?.length ?? '—'} hint="独立配置入口" />
    <Stat label="共享仓" value={inventory?.sharedRepositories?.length ?? '—'} hint="tool · agent · software" />
    <Stat label="架构文档" value={inventory?.architectureDocuments?.length ?? '—'} hint="来自 versions/" />
    <Stat label="Git" value={gitState} hint={inventory?.git?.branch || '未读取分支'} />
  </div>;
}
