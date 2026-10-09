import React, { useEffect, useState } from 'react';
import {SoftwareActionsPanel} from '../features/software/SoftwareActionsPanel.jsx';

export function SoftwarePanel({ api, workspace, inventory, software, softwareResults, checkSoftware, previewSoftwareLocation, previewSoftware, previewSoftwareImport, previewSoftwareRecipe, previewSoftwareRevert, previewSoftwareConnectorLaunch, setMessage, setPlanPreview, setPlanPayload }) {
  const [platformId, setPlatformId] = useState('');
  const [actionId,setActionId]=useState('');
  const [softwareId, setSoftwareId] = useState('');
  const [intakeKind, setIntakeKind] = useState('portable-file');
  const [sourcePath, setSourcePath] = useState('');
  const [intakes, setIntakes] = useState([]);
  const [recipeId, setRecipeId] = useState('');
  const [bodyName, setBodyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [upstreamVersion, setUpstreamVersion] = useState('');
  const [license, setLicense] = useState('unknown');
  const [versionFlag, setVersionFlag] = useState('--version');
  const [recoveries, setRecoveries] = useState([]);
  useEffect(() => {
    if (!workspace || !inventory) return;
    let active = true;
    api.listSoftwareRecoveries({ workspaceRoot: workspace }).then((rows) => { if (active) setRecoveries(rows); }).catch(() => { if (active) setRecoveries([]); });
    return () => { active = false; };
  }, [api, workspace, inventory]);
  useEffect(() => {
    if (!workspace || !platformId) { setIntakes([]); return; }
    let active = true;
    api.listSoftwareIntakes({ workspaceRoot: workspace, platformId }).then((rows) => { if (active) setIntakes(rows); }).catch(() => { if (active) setIntakes([]); });
    return () => { active = false; };
  }, [api, workspace, platformId, inventory]);
  const selectedPlatform = inventory?.platforms?.find((item) => item.id === platformId);
  const selectedIntake = intakes.find((item) => item.id === recipeId);
  const chooseSource = async () => {
    try {
      const selected = await api.selectSoftwareSource(intakeKind);
      if (!selected) { setMessage('已取消选择下载内容，未生成计划。'); return; }
      setSourcePath(selected);
    } catch (error) { setMessage(`选择文件失败：${String(error?.message ?? error)}`); }
  };
  return <><section className="panel software-panel"><div className="panel-title"><span>软件中心</span><span className="muted">recipe / connector</span></div><div className="rows">
    {recoveries.length > 0 && <div className="software-intake"><strong>最近可撤销的软件操作</strong>{recoveries.map((item) => <div className="catalog-row" key={item.checkpointPath}><span>{item.action === 'software-import' ? '安置本体' : '发布配方'} · {item.target}<small className="path-line">{item.occurredAt}</small></span><button className="small-button" onClick={() => previewSoftwareRevert(item)}>{item.action === 'software-import' ? '预览撤销安置' : '预览停用发布'}</button></div>)}</div>}
    {inventory && <div className="software-intake">
      <div className="integration-help">添加新软件：选择所属平台和来源。安置会生成备份与本体副本；大软件请预留空间。共享 software 仓只放配方。</div>
      <div className="integration-form">
        <label>所属平台<select value={platformId} onChange={(event) => { setPlatformId(event.target.value); setRecipeId(''); }}><option value="">请明确选择平台</option>{(inventory.platforms || []).filter((item) => item.directoryExists).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.softwareConnector?.ready ? '连接器已配置' : '连接器未配置'}</option>)}</select></label>
        <label>软件 ID（英文小写）<input value={softwareId} onChange={(event) => setSoftwareId(event.target.value.toLowerCase())} placeholder="例如 my-editor" /></label>
        <label>下载内容<select value={intakeKind} onChange={(event) => { setIntakeKind(event.target.value); setSourcePath(''); }}><option value="portable-file">便携程序文件</option><option value="unpacked-directory">已解压软件目录</option><option value="installer">安装包（只登记，不自动安装）</option></select></label>
      </div>
      {selectedPlatform && <div className="integration-help">{selectedPlatform.softwareConnector?.ready ? `连接器入口：${selectedPlatform.softwareConnector.gatewayPath}` : '该平台尚未绑定新版软件连接器；可先安置，但不能由本向导发布可调用配方。'}</div>}
      <div className="path-line">所选来源：{sourcePath || '尚未选择'}</div>
      <div className="resource-actions"><button className="small-button" onClick={chooseSource}>选择文件或目录</button><button className="small-button primary-small" disabled={!workspace || !platformId || !sourcePath || !/^[a-z0-9][a-z0-9._-]*$/.test(softwareId)} onClick={() => previewSoftwareImport({ platformId, softwareId, sourcePath, intakeKind })}>预览安置与备份计划</button></div>
    </div>}
    {inventory && <div className="software-intake">
      <div className="integration-help">旧版兼容入口：只发布 Windows CLI 版本查询。完整目录／ZIP、具体功能和 GUI 会话请使用“导入本体”页。</div>
      <div className="integration-form">
        <label>已安置的软件<select value={recipeId} onChange={(event) => { setRecipeId(event.target.value); setBodyName(''); }}><option value="">选择软件</option>{intakes.map((item) => <option key={item.id} value={item.id}>{item.id}{item.restored ? '' : ' · 备份待核验'}</option>)}</select></label>
        <label>程序入口<select value={bodyName} onChange={(event) => setBodyName(event.target.value)}><option value="">选择 exe</option>{(selectedIntake?.files || []).filter((name) => name.toLowerCase().endsWith('.exe')).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>软件名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 My Editor" /></label>
        <label>上游版本<input value={upstreamVersion} onChange={(event) => setUpstreamVersion(event.target.value)} placeholder="须与版本查询输出一致" /></label>
        <label>许可证<input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="不确定可填 unknown" /></label>
        <label>版本参数<select value={versionFlag} onChange={(event) => setVersionFlag(event.target.value)}><option value="--version">--version</option><option value="-V">-V</option><option value="-v">-v</option></select></label>
      </div>
      <div className="resource-actions"><button className="small-button primary-small" disabled={!selectedPlatform?.softwareConnector?.ready || !selectedIntake?.restored || selectedIntake?.intakeKind === 'installer' || !bodyName || !displayName.trim() || !upstreamVersion.trim()} onClick={() => previewSoftwareRecipe({ platformId, softwareId: recipeId, bodyName, displayName, upstreamVersion, license, versionFlag })}>询问版本并预览配方</button></div>
    </div>}
    {software.map((item) => { const result = softwareResults[platformId+'/'+item.id]; const bodyPath = selectedPlatform?.softwareConnector?.bodies?.[item.id]; return <div className="software-row" key={item.id}><div className="software-main"><span className="row-name">{item.displayName}</span><span className="resource-repo">{item.id} · {item.version}</span><div className="software-meta">{item.transport || '未声明'} · {item.bodyExists === true ? '本体已发现' : item.bodyExists === false ? '本体未发现' : '路径待核对'} · {item.snapshotFrozen ? '快照已冻结' : '快照待核验'}</div><div className="software-path"><strong>绝对路径：</strong>{bodyPath || (platformId ? '该平台未绑定本体' : '请先选择所属平台')}<br /><strong>工作区相对配方：</strong>{item.versionRoot}<br /><strong>入口模板（未解析，不是可直接执行的命令）：</strong>{item.entrypoint || item.versionCall?.[0] || '未声明'}{item.endpoint && <><br /><strong>端点：</strong>{item.endpoint}</>}</div></div><div className="resource-actions software-actions"><span className={result?.status === 'PASS' || result?.status === 'READY' ? 'pill good' : result ? 'pill warn' : 'pill'}>{result?.status || '未检查'}</span><button className="small-button" disabled={!platformId} onClick={() => checkSoftware(item,platformId)}>健康检查</button><button className="small-button" disabled={!platformId} onClick={() => setActionId(item.id)}>功能参数与会话</button><button className="small-button" disabled={!bodyPath} onClick={() => previewSoftwareLocation(item, platformId)}>打开位置</button><button className="small-button" onClick={() => previewSoftware(item)}>查看启动条件</button></div></div>; })}
    {!inventory && <div className="empty">选择工作区后显示软件。</div>}
  </div></section><SoftwareActionsPanel api={api} workspace={workspace} platformId={platformId} softwareId={actionId} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} /></>;
}
