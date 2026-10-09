import React from 'react';

export function IntegrationPanel({ api, workspace, resources, integrationKind, setIntegrationKind, integrationOptions, integrationTargetId, setIntegrationTargetId, integrationMode, setIntegrationMode, integrationPaths, integrationPath, setIntegrationPath, integrationTarget, setIntegrationTarget, integrationText, setIntegrationText, integrationTargetVersion, setIntegrationTargetVersion, platformSuggestion, reloadIntegrationTarget, previewIntegration, friendlyError, setMessage }) {
  const chooseTarget = (next) => {
    setIntegrationTargetId(next);
    if (next === '__registry__') setIntegrationMode('registry');
  };
  const choosePath = (next) => {
    setIntegrationPath(next);
    const selected = integrationPaths.find((item) => item === next);
    if (!selected) return;
    api.readIntegrationTarget({ workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId, relativePath: selected })
      .then((detail) => { setIntegrationTarget(detail); setIntegrationText(detail.content || ''); })
      .catch((error) => setMessage('接入目标读取失败：' + friendlyError(error)));
  };
  return <section className="panel integration-panel">
    <div className="panel-title"><span>接入与版本向导</span><span className="muted">预览 → 确认 → 验证</span></div>
    <div className="integration-help">选好对象后，管理台会生成操作预览。平台不必手写 JSON；配置文件保存成功不代表客户端已经接通，仍需单独验证。</div>
    <div className="integration-form">
      <label>对象类型<select value={integrationKind} onChange={(event) => { const next = event.target.value; setIntegrationKind(next); setIntegrationMode(next === 'platform' ? 'config' : 'pointer'); setIntegrationTargetId(''); setIntegrationTarget(null); }}><option value="platform">platform</option><option value="tool">tool</option><option value="agent">agent</option><option value="software">software</option></select></label>
      <label>对象<select value={integrationTargetId} onChange={(event) => chooseTarget(event.target.value)}><option value="">选择对象</option>{integrationOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      {integrationKind !== 'platform' && <label>动作<select value={integrationMode} onChange={(event) => setIntegrationMode(event.target.value)}><option value="pointer">切换 current 指针</option><option value="registry">修改 registry</option></select></label>}
      {integrationKind !== 'platform' && <label>目标文件<select value={integrationPath} onChange={(event) => choosePath(event.target.value)}><option value="">选择目标</option>{integrationPaths.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>}
      {integrationMode === 'pointer' && integrationTarget && <label>目标版本<select value={integrationTargetVersion} onChange={(event) => setIntegrationTargetVersion(event.target.value)}><option value="">选择已发布版本</option>{(resources.find((item) => item.repository === integrationKind && item.resourceId === integrationTargetId)?.availableVersions || []).map((version) => <option key={version} value={version}>{version}</option>)}</select></label>}
    </div>
    {integrationKind === 'platform' && platformSuggestion && <div className="integration-help">目标：{platformSuggestion.path}。{platformSuggestion.source === 'canonical' ? '已有标准配置，可继续做接通检查。' : platformSuggestion.source === 'legacy' ? '将旧配置复制到标准位置；若发现客户端仍指向旧文件，会在计划中一同迁移引用。旧文件保留。' : platformSuggestion.nextStep === 'adapter-required' ? '可生成基础配置，但缺客户端适配器；保存后仍为“待适配”。' : '已找到客户端配置，可生成标准 bridge。'}</div>}
    {integrationTarget && integrationMode !== 'pointer' && <><div className="path-line">基线 SHA-256：{integrationTarget.sha256 || '新文件'} · 目标：{integrationTarget.path}</div><textarea className="integration-editor" value={integrationText} onChange={(event) => setIntegrationText(event.target.value)} readOnly={integrationKind === 'platform'} spellCheck={false} aria-label="配置预览" /></>}
    <div className="resource-actions"><button className="small-button" onClick={reloadIntegrationTarget} disabled={!integrationTarget}>重新读取目标</button><button className="small-button primary-small" onClick={previewIntegration} disabled={!integrationTarget || (integrationKind === 'platform' && platformSuggestion?.source === 'canonical') || (integrationMode === 'pointer' ? !integrationTargetVersion : !integrationText)}>{integrationKind === 'platform' ? '预览创建 bridge.json' : '生成接入计划'}</button></div>
  </section>;
}
