import React, { useEffect,useState } from 'react';

export function ReleasePanel({ api, workspace,inventory, resources, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [repository, setRepository] = useState('tool');
  const [resourceId, setResourceId] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [upgradeFrom, setUpgradeFrom] = useState('');
  const [definitionOverride, setDefinitionOverride] = useState('');
  const [platformId,setPlatformId]=useState(inventory?.platforms?.[0]?.id || ''),[content,setContent]=useState(''),[adopt,setAdopt]=useState(false),[dependencies,setDependencies]=useState(null),[runnerWorkflow,setRunnerWorkflow]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;if(workspace)api.listBodyDependencies({workspaceRoot:workspace}).then(value=>{if(active)setDependencies(value);}).catch(error=>{if(active)setError(friendlyError(error));});return ()=>{active=false;};},[api,workspace]);
  const [references, setReferences] = useState(null);
  const [markId, setMarkId] = useState('');
  const [markKind, setMarkKind] = useState('workflow');
  const [supersededBy, setSupersededBy] = useState('');
  const [deprecationNote, setDeprecationNote] = useState('');
  const candidates = resources.filter((resource) => resource.repository === repository);
  const previewRelease = async () => {
    if (!workspace) { setMessage('请先选择工作区。'); return; }
    try {
      const plan = await api.previewReleasePlan({ workspaceRoot: workspace,platformId, repository, resourceId, targetVersion, upgradeFrom: upgradeFrom || null, definitionOverride: definitionOverride || null,content:content || null,adopt,runnerWorkflow:runnerWorkflow || null });
      setPlanPreview(plan);
      setPlanPayload(null);
      setError('');setMessage(`已生成发布计划：${plan.target.destination}；${plan.payload.changes.length?'本次将登记并采用':'本次仅发布，当前默认版保持原样'}。`);
    } catch (error) {
      setError(friendlyError(error));setMessage(`发布计划被拒绝：${friendlyError(error)}`);
    }
  };
  const showReferences = async () => {
    try {
      const result = await api.listResourceReferences({ workspaceRoot: workspace, repository, resourceId });
      setReferences(result);
      setMessage(`在 ${result.scanned} 个现行发布文件中找到 ${result.references.length} 处提及。`);
    } catch (error) {
      setMessage(`引用扫描失败：${friendlyError(error)}`);
    }
  };
  const previewMark = async () => {
    try {
      const baseline = await api.readRegistryBaseline({ workspaceRoot: workspace, kind: markKind });
      const plan = await api.previewRegistryPlan({ workspaceRoot: workspace, kind: markKind, action: 'mark', id: markId, entry: { supersededBy, deprecationNote }, baselineSha256: baseline.sha256 });
      setPlanPreview(plan);
      setPlanPayload({ afterText: plan.payload.afterText });
      setMessage(`已生成 deprecated 标记计划：${plan.target.description}。尚未写入。`);
    } catch (error) {
      setMessage(`标记计划被拒绝：${friendlyError(error)}`);
    }
  };
  return <section className="panel"><div className="panel-title"><span>三仓发布向导（发布 ≠ 采纳）</span><span className="muted">新目录 + SOURCE.json + 双向 SHA256SUMS；已发布字节不覆盖</span></div>
    {!workspace && <div className="empty">选择工作区后可用。</div>}
    {workspace && <div>
      <div className="wizard-section">发布新版本（新目录 + 双向 SHA256SUMS，不碰已发布字节）</div>
      <div className="wizard-grid">
        <div className="wizard-field"><label>维护所属平台</label><select value={platformId} onChange={event=>setPlatformId(event.target.value)}><option value="">请选择</option>{inventory?.platforms?.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></div>
        <div className="wizard-field"><label>仓库</label><select value={repository} onChange={(event) => setRepository(event.target.value)}><option value="tool">tool</option><option value="agent">agent</option></select></div>
        <div className="wizard-field"><label>资源 ID</label><input value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="如 game-pipeline" /></div>
        <div className="wizard-field"><label>新版本 x.y.z</label><input value={targetVersion} onChange={(event) => setTargetVersion(event.target.value)} placeholder="1.1.0" /></div>
        <div className="wizard-field"><label>升级脚手架来源</label><select value={upgradeFrom} onChange={(event) => setUpgradeFrom(event.target.value)}><option value="">全新模板</option>{(candidates.find((resource) => resource.resourceId === resourceId)?.availableVersions || []).map((version) => <option key={version} value={version}>{version}</option>)}</select></div>
        <div className="wizard-field"><label>从指针选择</label><select value="" onChange={(event) => setResourceId(event.target.value)}><option value="">选择…</option>{candidates.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.resourceId}</option>)}</select></div>
      </div>
      <div className="wizard-field"><label>{repository==='tool'?'新模板的任务说明（或保留来源版）':'专家正文（或保留来源版）'}</label><textarea rows={5} value={content} onChange={event=>setContent(event.target.value)} placeholder="新模板提供一个可领取的通用提示词阶段；复杂阶段请用导入本体或编辑工作流。" /></div>
      {repository==='agent' && <div className="wizard-field"><label>主工作流（新建专家须选择）</label><select value={runnerWorkflow} onChange={event=>setRunnerWorkflow(event.target.value)}><option value="">保留来源版主工作流</option>{dependencies?.workflows.map(row=><option key={row.id} value={row.id}>{row.id}@{row.version}</option>)}</select></div>}
      {repository==='tool' && <label><input type="checkbox" checked={adopt} onChange={event=>setAdopt(event.target.checked)} />发布后设为默认版（新 ID 会自动登记；升级未勾选时仅发布）</label>}
      {error && <div className="scan-result warning" role="alert">{error}</div>}
      <div className="git-actions">
        <button className="small-button" onClick={showReferences} disabled={!resourceId}>查引用影响面</button>
        <button className="small-button" onClick={previewRelease} disabled={!platformId || !resourceId || !targetVersion || repository==='agent' && !upgradeFrom && !runnerWorkflow}>生成发布计划</button>
      </div>
      {references && <div className="scan-result clean">引用影响面（切换指针前先看这里）：{references.references.length === 0 ? '现行发布文件中无提及' : <ul className="finding-list">{references.references.slice(0, 10).map((reference) => <li key={reference.path}><code>{reference.path}</code></li>)}</ul>}{references.truncated ? '（截断到 50 条）' : ''}</div>}
      <div className="wizard-section">标记 deprecated（不改 enabled，钉旧版的 run 仍可解析）</div>
      <div className="wizard-grid">
        <div className="wizard-field"><label>类别</label><select value={markKind} onChange={(event) => setMarkKind(event.target.value)}><option value="workflow">workflow</option><option value="agent">agent</option><option value="skill">skill</option></select></div>
        <div className="wizard-field"><label>资源 ID</label><input value={markId} onChange={(event) => setMarkId(event.target.value)} placeholder="资源 ID" /></div>
        <div className="wizard-field"><label>supersededBy（必填）</label><input value={supersededBy} onChange={(event) => setSupersededBy(event.target.value)} /></div>
        <div className="wizard-field"><label>备注（可选）</label><input value={deprecationNote} onChange={(event) => setDeprecationNote(event.target.value)} /></div>
      </div>
      <div className="git-actions"><button className="small-button" onClick={previewMark} disabled={!markId || !supersededBy}>生成标记计划</button></div>
      <div className="muted">结构校验可另跑 repo-lint --new-release（P12 验收集统一调用）；此处计划生成即通过双向哈希自检。</div>
    </div>}
  </section>;
}
