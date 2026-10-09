import {GatewayBindings} from '../shared/GatewayBindings.jsx';
import React, { useEffect, useState, useRef } from 'react';
import {useSelectionApi} from '../shared/useSelectionApi.mjs';
import {OnboardingDraft} from '../shared/onboarding-draft.mjs';

const STEPS = ['选择平台', '完整配置', '准备环境', '客户端入口', '检查与接入', '登记与恢复'];
const MODULES={configuration:'配置',backend:'隔离后端',environment:'运行环境',providers:'平台 provider',capabilities:'能力实测',client:'服务通道验证',native:'厂商原生三仓验证',software:'软件绑定',certification:'完整认证',governance:'治理登记',git:'Git 提交'};
const EMPTY = { displayName: '', pythonExecutable: '', environmentManifest: '', scriptEnvironment: '', executionBackend: '', peerDispatcherModule: '', peerContentRoot: '', softwareGateway: '', softwareEnvironment: '', clientKind: 'cli', clientExecutable: '', clientArgs: [], probeTool: '', probeArguments: {} };

export function OnboardPanel({ api, workspace, inventory, busy = false, setPlanPreview, setPlanPayload, setMessage, friendlyError }) {
  const [selection, setSelection] = useState('__new__');
  const [newId, setNewId] = useState('');
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const [snapshot, setSnapshot] = useState(null);
  const [localWorking, setWorking] = useState(false);
  const working = localWorking || busy;
  const [result, setResult] = useState(null);
  const [capabilityEvidence, setCapabilityEvidence] = useState(null);
  const [nativeBodyPath,setNativeBodyPath]=useState('');
  const [native,setNative]=useState(null);
  const [localError, setLocalError] = useState('');
  const [runtime, setRuntime] = useState(null);
  const [softwareBodies, setSoftwareBodies] = useState({});
  const [softwarePython, setSoftwarePython] = useState('');
  const [deferred,setDeferred]=useState([]);
  const [backendFields, setBackendFields] = useState({ distro: '', guestInterpreter: '/usr/bin/python3', wslExecutable: '' });
  const platformId = selection === '__new__' ? newId : selection;
  const draft=useRef(new OnboardingDraft());
  const context=workspace+':'+platformId;
  api=useSelectionApi(api,context);
  const currentContext=useRef(context);currentContext.current=context;
  const editBodies=values=>{for(const key of Object.keys(values))if(values[key]!==softwareBodies[key])draft.current.edit('bodies',key);setSoftwareBodies(values);};
  const editBackend=(values,editedKey)=>{if(editedKey)draft.current.edit('backend',editedKey);for(const key of Object.keys(values))if(values[key]!==backendFields[key])draft.current.edit('backend',key);setBackendFields(values);};
  const editSoftwarePython=value=>{draft.current.edit('softwarePython');setSoftwarePython(value);};
  const input = () => ({ workspaceRoot: workspace, platformId, fields, confirmed });
  const field = (key, value) => {draft.current.edit('fields',key);setFields(old=>({...old,[key]:value}));};
  useEffect(() => {
    if (!workspace || !/^[a-z][a-z0-9-]{1,30}$/.test(platformId)) { setSnapshot(null); return; }
    const changed=draft.current.select(context),token=draft.current.begin();
    if(changed){setFields(EMPTY);setSoftwareBodies({});setSoftwarePython('');setBackendFields({distro:'',guestInterpreter:'/usr/bin/python3',wslExecutable:''});setRuntime(null);setResult(null);setSnapshot(null);setWorking(false);setCapabilityEvidence(null);setNativeBodyPath('');setNative(null);}
    let active = true;
    api.readOnboardingConfig({ workspaceRoot: workspace, platformId }).then((data) => {
      if (!active || !draft.current.accepts(token)) return;
      setSnapshot(data);setFields(old=>draft.current.merge('fields',old,data.fields));setLocalError('');
      setSoftwareBodies(old=>draft.current.merge('bodies',old,data.registeredBodies || {}));
      setBackendFields(old=>draft.current.merge('backend',old,data.backendFields || {}));
      if(draft.current.untouched('softwarePython'))setSoftwarePython(data.registeredInterpreterAliases?.PPython || '');
      if (data.pendingAutomatic) {
        const saved = data.pendingAutomatic.inputs;
        if(!data.backendFields?.distro)setBackendFields(old=>draft.current.merge('backend',old,saved.backendFields || {}));
        if(changed){setConfirmed(saved.confirmed);setDeferred(saved.deferred || []);setNativeBodyPath(saved.nativeBodyPath || '');}
        setResult({ ...data.pendingAutomatic,status: data.pendingAutomatic.status==='configured-pending'?'本轮配置已保存 · 接入未完成':`已恢复接入参数；上次停止在 ${MODULES[data.pendingAutomatic.stoppedAt] || data.pendingAutomatic.stoppedAt || '未完成步骤'}` });
      }else if(changed)setDeferred([]);
    }).catch((error) => { if (active) setLocalError(friendlyError(error)); });
    return () => { active = false; };
  }, [workspace, platformId, inventory]);
  useEffect(()=>{let active=true;if(workspace && platformId && selection!=='__new__')api.nativeClientStatus({workspaceRoot:workspace,platformId}).then(value=>{if(active)setNative(value);}).catch(()=>{});return ()=>{active=false;};},[workspace,platformId,inventory]);
  const act = async (operation, message) => {
    const identity=context;
    setWorking(true); setLocalError('');
    try {
      const value = await operation();
      if(identity!==currentContext.current)return;
      if (value?.schema === 'architecture-manager-plan/v1') { setPlanPreview(value); setPlanPayload(null); }
      else setResult(value);
      if (message) setMessage(message);
      return value;
    } catch (error) { if(identity!==currentContext.current || error.message==='STALE_TASK_RESULT')return;const text = friendlyError(error); setLocalError(text); setMessage(text); }
    finally { if(identity===currentContext.current)setWorking(false); }
  };
  const pickFile=async apply=>{try{const path=await api.selectOnboardingFile();if(path)apply(path);else setLocalError('已取消选择文件。');}catch(error){if(error.message!=='STALE_TASK_RESULT')setLocalError(friendlyError(error));}};
  const selectFile=key=>pickFile(path=>field(key,path));
  const previewAutomatic=async resumeMode=>act(async()=>{
    const latest=await api.readOnboardingConfig({workspaceRoot:workspace,platformId});
    const current=resumeMode==='reconcile'?draft.current.merge('fields',fields,latest.fields):fields;
    return api.previewAutomaticOnboardingPlan({workspaceRoot:workspace,platformId,fields:current,confirmed,backendFields,nativeBodyPath,bodies:resumeMode==='reconcile'?draft.current.merge('bodies',softwareBodies,latest.registeredBodies):softwareBodies,interpreterAliases:resumeMode==='reconcile'?{...latest.registeredInterpreterAliases,PPython:softwarePython}:{PPython:softwarePython},deferred,resumeMode});
  },'接入计划已生成；暂缓项与配置差异在预览中列出，确认前不会修改日志。');
  const run = async () => {
    if (!await api.confirm(`开始 ${platformId} 的接入检查？将使用它自己的配置和环境，保存逐步记录。没有通过的能力不会被声明为已接入。`)) return;
    return act(() => api.runOnboardingPipeline({ workspaceRoot: workspace, platformId, includeMatrix: true }), '接入执行结果已返回。');
  };
  const nativeAiProbe=async()=>{
    if(!await api.confirm('允许本次使用 WorkBuddy 原生模型验证一次吗？只允许一个只读工具读取三仓冻结文本，不执行业务、不自动重试，可能消耗厂商额度。'))return;
    return act(async()=>{const value=await api.probeNativeClientWithAi({workspaceRoot:workspace,platformId,aiConsent:true});setNative(value);return value;},'本次原生 AI 验证已返回；是否通过以真实工具回执为准。');
  };
  const fileField = (key, label) => <label className="onboarding-field" key={key}><span>{label}</span><div className="onboarding-input"><input value={fields[key] || ''} onChange={(event) => field(key, event.target.value)} /><button className="small-button" disabled={working} onClick={() => selectFile(key)}>选择文件</button></div></label>;
  return <section className="panel onboarding-panel">
    <div className="panel-title"><span>平台接入向导</span><span className="muted">配置、环境、入口与验证由管理台执行</span></div>
    {!workspace ? <div className="empty">请先选择你的架构工作区。</div> : <>
      <nav className="onboarding-steps" aria-label="接入步骤">{STEPS.map((name, index) => <button className={`small-button ${step === index ? 'primary-small' : ''}`} key={name} onClick={() => setStep(index)}>{index + 1}. {name}</button>)}</nav>
      <div className="onboarding-automatic"><strong>确认一次连续执行；暂不需要的模块可稍后补齐</strong><p>配置和安全边界必查。暂缓不会算通过，也不会显示完整接入；未满足地板时不启动完整矩阵，其它选中步骤仍可保存。</p><fieldset><legend>本次暂缓（可多选）</legend>{[['environment','运行环境与能力实测'],['software','软件本体绑定'],['client','客户端验证'],['certification','接入认证／首次矩阵'],['git','Git 提交']].map(([name,label])=><label key={name} className="sensitive-confirm"><input type="checkbox" disabled={working} checked={deferred.includes(name)} onChange={event=>setDeferred(old=>event.target.checked?[...old,name]:old.filter(item=>item!==name))} />暂缓{label}</label>)}<p>暂缓环境会连带暂缓依赖它的 provider/能力/客户端/认证；暂缓软件或客户端会连带暂缓完整认证。后续取消勾选并继续即可补齐。</p></fieldset><div className="git-actions"><button className="primary-small small-button" disabled={working || !snapshot || (selection === '__new__' && !confirmed)} onClick={()=>previewAutomatic('strict')}>预览一键接入／继续</button><button className="small-button" disabled={working || !snapshot?.exists} onClick={()=>previewAutomatic('reconcile')}>核对当前更改后续接</button><button className="small-button" disabled={working || !snapshot?.exists} onClick={()=>previewAutomatic('restart')}>预览重建接入记录</button></div>{snapshot?.resumePreview?.changes?.length>0 && <div className="notice">检测到 {snapshot.resumePreview.changes.length} 项配置更改；请用“核对当前更改后续接”。旧记录会留日期副本，受影响结果重新验证。</div>}</div>
      {snapshot?.providerTemplates && !snapshot.providerTemplates.current && <div className="notice"><strong>平台安装的组件需要更新</strong><p>旧组件不会因打开新版管理台而自动改变。确认下面的更新计划后，仅重验受影响能力。</p><button className="small-button" disabled={working || !snapshot.exists} onClick={()=>act(()=>api.previewOnboardingProvidersPlan({workspaceRoot:workspace,platformId}),'组件更新计划已生成；已有软件绑定保留。')}>预览更新已安装组件</button></div>}
      <GatewayBindings binding={snapshot?.gatewayBinding} workspace={workspace} platformId={platformId} api={api} act={act} working={working} />
      {localError && <div role="alert" className="onboarding-error">{localError}</div>}
      {step === 0 && <>
        <label className="onboarding-field"><span>操作对象</span><select value={selection} onChange={(event) => { setSelection(event.target.value); setResult(null); setConfirmed(false); }}><option value="__new__">新增平台</option>{(inventory?.platforms || []).map((item) => <option key={item.id} value={item.id}>{item.id} · 修复或升级接入</option>)}</select></label>
        {selection === '__new__' && <label className="onboarding-field"><span>平台 ID</span><input value={newId} onChange={(event) => setNewId(event.target.value.toLowerCase())} placeholder="例如 my-client" /></label>}
        <label className="onboarding-field"><span>显示名称</span><input value={fields.displayName || ''} onChange={(event) => field('displayName', event.target.value)} /></label>
        {selection === '__new__' && <label className="sensitive-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 允许在本工作区创建该平台一级目录</label>}
        <p className="muted">已有平台会保留原配置和运行锁；预览中列出本轮要修改的文件。</p>
        <label className="onboarding-field"><span>厂商平台本体（可自动识别本平台已有程序）</span><div className="onboarding-input"><input value={nativeBodyPath} onChange={event=>setNativeBodyPath(event.target.value)} placeholder="留空自动识别；多个程序时选择要接入的 EXE" /><button className="small-button" disabled={working} onClick={()=>pickFile(setNativeBodyPath)}>选择程序</button></div></label>
        <p className="muted">一键预览会自动探测现有兼容 Python 与 WSL；无需先手填这些路径。厂商外部接口缺失时会保存准备结果并明确等待接口。</p>
        {snapshot?.exists && <button className="small-button" disabled={working} onClick={() => act(async()=>{const data=await api.readOnboardingConfig({workspaceRoot:workspace,platformId});draft.current.dirty.clear();setSnapshot(data);setFields(data.fields);setSoftwareBodies(data.registeredBodies || {});setSoftwarePython(data.registeredInterpreterAliases?.PPython || '');setBackendFields({distro:'',guestInterpreter:'/usr/bin/python3',wslExecutable:'',...data.backendFields});setRuntime(null);setCapabilityEvidence(null); setResult({ status: '已读取当前生效配置；重新预览会保留已激活的环境，并核对新的版本与能力。' });return data;})}>重新读取当前配置（放弃未保存编辑）</button>}
      </>}
      {step === 1 && <>
        <p>目标：{platformId || '未选平台'}。三仓根路径自动取当前工作区。</p>
        {snapshot && <div className="onboarding-versions">{Object.values(snapshot.versions).map((item) => <span className="pill" key={item.id}>共享默认：{item.id} {item.version}</span>)}</div>}
        {snapshot?.performanceRecommendation && <div className="notice"><strong>可选择提速配对</strong><p>引擎 {snapshot.performanceRecommendation.runnerVersion} · 检查器 {snapshot.performanceRecommendation.scannerVersion} · 契约 {snapshot.performanceRecommendation.contractsVersion} · 调用判据 {snapshot.performanceRecommendation.matrixVersion}。选择后仍需预览并保存配置；现有默认不会自动改变。</p><button className="small-button" disabled={working} onClick={()=>Object.entries(snapshot.performanceRecommendation).forEach(([key,value])=>field(key,value))}>选择这套提速版本</button></div>}
        <label className="onboarding-field"><span>有效上下文窗口（固定提示预算依据，历史消息另计）</span><input type="number" min="1" value={fields.contextWindowTokens || ''} onChange={event=>field('contextWindowTokens',event.target.value)} /></label>
        <label className="onboarding-field"><span>窗口来源</span><input value={fields.contextWindowSource || ''} onChange={event=>field('contextWindowSource',event.target.value)} /></label>
        <label className="onboarding-field"><span>本平台资源环境清单</span><input value={fields.resourceEnvironmentManifest || ''} onChange={event=>field('resourceEnvironmentManifest',event.target.value)} /></label>
        {[['runnerVersion','wf-runner','运行引擎'],['contractsVersion','runtime-contracts','运行契约'],['scannerVersion','repo-lint','资源检查器']].map(([key,id,label]) => <label className="onboarding-field" key={key}><span>{label} · 当前使用 {snapshot?.config?.[key==='runnerVersion' ? 'runner':key==='contractsVersion' ? 'contracts':'scannerRelease']?.split(/[\\/]/).at(-1) || '未配置'}</span><select disabled={working} value={fields[key] || ''} onChange={(event)=>field(key,event.target.value || null)}><option value="">使用共享默认 {snapshot?.versions[id]?.version || ''}</option>{(inventory?.sharedRepositories?.find(repo=>repo.repository==='tool')?.pointers?.find(item=>item.resourceId===id)?.availableVersions || []).map(version=><option key={version} value={version}>{version}</option>)}</select></label>)}
        {fileField('pythonExecutable', 'Python 解释器')}
        <details><summary>高级配置：环境、委派与软件位置</summary>{[['environmentManifest', '环境清单'], ['executionBackend', '隔离后端配置'], ['peerDispatcherModule', '委派 provider'], ['softwareGateway', '软件连接器'], ['softwareEnvironment', '软件本体登记']].map(([key, label]) => fileField(key, label))}
        <label className="onboarding-field"><span>脚本环境目录</span><input value={fields.scriptEnvironment || ''} onChange={(event) => field('scriptEnvironment', event.target.value)} /></label>
        <label className="onboarding-field"><span>委派内容目录</span><input value={fields.peerContentRoot || ''} onChange={(event) => field('peerContentRoot', event.target.value)} /></label></details>
        <button className="small-button primary-small" disabled={working || !snapshot || (selection === '__new__' && !confirmed)} onClick={() => act(() => api.previewOnboardingConfigPlan(input()), '完整配置计划已生成，请核对后确认执行。')}>预览并保存完整配置</button>
      </>}
      {step === 2 && <>
        <p>所需解释器和库安装在 {platformId || '所选平台'}/runtime 内；缺少系统设施时会暂停并告诉你需要点击什么。</p>
        {fileField('pythonExecutable', '用于准备环境的 Python')}
        <button className="small-button" disabled={working} onClick={() => act(async () => { const value = await api.detectOnboardingRuntime({ pythonExecutable: fields.pythonExecutable }); setRuntime(value); setBackendFields(old=>draft.current.merge('backend',old,{...old,wslExecutable:value.wslExecutable || '',distro:old.distro || value.distributions[0] || ''})); return value; })}>检测解释器与 WSL</button>
        {runtime && <><label className="onboarding-field"><span>隔离环境</span><select value={backendFields.distro} onChange={(event) => editBackend({ ...backendFields, distro: event.target.value },'distro')}><option value="">选择已安装的 WSL 环境</option>{[...new Set([backendFields.distro,...runtime.distributions].filter(Boolean))].map((name) => <option key={name}>{name}</option>)}</select></label><button className="small-button" disabled={working || !backendFields.distro} onClick={() => act(() => api.previewOnboardingBackendPlan({ workspaceRoot: workspace, platformId, fields: backendFields }), '隔离后端计划已生成。')}>保存所选隔离后端</button></>}
        {fileField('executionBackend', '本平台隔离后端配置')}
        <button className="small-button primary-small" disabled={working || !snapshot || !snapshot.exists || !api.previewOnboardingRuntimePlan} onClick={() => act(() => api.previewOnboardingRuntimePlan(input()), '环境准备计划已生成；安装前先核对下载和磁盘位置。')}>准备独立运行环境</button>
        <p className="muted">软件本体位置与 provider 可在软件中心绑定；清空路径并保存会解除该项绑定，程序文件保留，缺口会如实列出。</p>
        <details><summary>绑定软件本体与平台 provider</summary>{(inventory?.repositories?.software?.entries || inventory?.software || []).filter((entry) => entry.id && !entry.id.startsWith('_')).map((entry) => <label className="onboarding-field" key={entry.id}><span>{entry.id} 的程序文件</span><div className="onboarding-input"><input value={softwareBodies[entry.id] || ''} onChange={(event) => editBodies({ ...softwareBodies, [entry.id]: event.target.value })} /><button className="small-button" disabled={working} onClick={()=>pickFile(path=>{draft.current.edit('bodies',entry.id);setSoftwareBodies(old=>({...old,[entry.id]:path}));})}>选择文件</button></div></label>)}<label className="onboarding-field"><span>软件配方 PPython 解释器（如需要）</span><div className="onboarding-input"><input value={softwarePython} onChange={(event) => editSoftwarePython(event.target.value)} /><button className="small-button" disabled={working} onClick={()=>pickFile(editSoftwarePython)}>选择文件</button></div></label><button className="small-button" disabled={working || !snapshot?.exists} onClick={() => act(() => api.previewOnboardingProvidersPlan({ workspaceRoot: workspace, platformId, bodies: softwareBodies, interpreterAliases: {PPython:softwarePython} }), 'provider 和软件位置计划已生成；保存后仍需真实探测。')}>保存软件位置与 provider</button></details>
      </>}
      {step === 3 && <>
        <div className="notice"><strong>原生客户端接入</strong><p>先准备服务通道，再自动写入厂商支持的 MCP 配置并直接验证三仓。标准 CLI 自测通过只算服务可用。</p><label className="onboarding-field"><span>厂商程序</span><div className="onboarding-input"><input value={nativeBodyPath} onChange={event=>setNativeBodyPath(event.target.value)} placeholder={native?.profile?.bodyPath || '留空自动识别本平台程序'} /><button className="small-button" disabled={working} onClick={()=>pickFile(setNativeBodyPath)}>选择程序</button></div></label><button className="small-button primary-small" disabled={working || !snapshot?.exists} onClick={()=>act(()=>api.previewNativeClientPlan({workspaceRoot:workspace,platformId,bodyPath:nativeBodyPath}),'原生注册计划已生成；原配置有加密备份，真实调用单独判定。')}>预览注册原生客户端</button><button className="small-button" disabled={working || !native?.registered} onClick={()=>act(async()=>{const value=await api.probeNativeClient({workspaceRoot:workspace,platformId});setNative(value);return value;})}>验证原生三仓调用</button>{native?.profile?.kind==='workbuddy-cli' && <button className="small-button" disabled={working || !native?.registered} onClick={nativeAiProbe}>允许一次原生 AI 只读验证</button>}<button className="small-button" disabled={working || !snapshot?.exists} onClick={()=>act(async()=>{const value=await api.nativeClientStatus({workspaceRoot:workspace,platformId});setNative(value);return value;})}>刷新原生状态</button>{native && <p>配置注册：{native.registered?'已保存':'未注册'}；原生三仓调用：{native.nativeVendorClientVerified?'真实调用已验证':'待验证'}。{native.reason || ''}</p>}</div>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists} onClick={() => act(() => api.previewOnboardingClientPlan({ workspaceRoot: workspace, platformId }), '标准 CLI 客户端和 MCP 服务安装计划已生成。')}>安装标准 CLI 客户端入口</button>
        <p>标准 CLI 入口通过真实 MCP 连接调用维护探针，无需模型生成回复。厂商原生客户端注册另行显示，不会由此标成通过。</p>
        <label className="onboarding-field"><span>客户端接口</span><select value={fields.clientKind} onChange={(event) => field('clientKind', event.target.value)}><option value="cli">JSON CLI 客户端入口</option><option value="mcp-stdio">MCP stdio 客户端入口</option><option value="manual-native">原生客户端测试回执</option></select></label>
        {fileField('clientExecutable', '客户端入口程序')}
        <label className="onboarding-field"><span>入口参数（每行一项）</span><textarea value={(fields.clientArgs || []).join('\n')} onChange={(event) => field('clientArgs', event.target.value.split('\n').filter(Boolean))} /></label>
        {fields.clientKind === 'mcp-stdio' && <label className="onboarding-field"><span>只读回环工具名</span><input value={fields.probeTool || ''} onChange={(event) => field('probeTool', event.target.value)} /></label>}
        <p className="muted">入口需返回本次随机挑战和配置摘要。连通服务与原生客户端已注册会分别显示。</p>
        <button className="small-button" disabled={working || !snapshot} onClick={() => act(() => api.previewOnboardingConfigPlan(input()), '客户端配置计划已生成。')}>保存客户端入口</button>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists || !api.probeOnboardingClient} onClick={() => act(() => api.probeOnboardingClient({ workspaceRoot: workspace, platformId }), '客户端测试结果已返回。')}>测试真实客户端入口</button>
      </>}
      {step === 4 && <>
        <p>开始前请保存配置并完成环境与入口准备。首次接入执行完整矩阵；失败会停在具体步骤。</p>
        <button className="small-button" disabled={working || !snapshot?.exists} onClick={() => act(async () => { const value = await api.probeOnboardingCapabilities({ workspaceRoot: workspace, platformId }); setCapabilityEvidence(value.evidencePath); return value; }, '能力探针已返回，请查看实际通过项和缺口。')}>实测所需能力</button>
        <button className="small-button" disabled={working || !capabilityEvidence} onClick={() => act(() => api.previewOnboardingAttestationPlan({ workspaceRoot: workspace, platformId, evidencePath: capabilityEvidence }), '仅将真实通过项生成能力更新计划。')}>保存真实能力声明</button>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists} onClick={run}>{working ? '接入检查中…' : '开始接入／继续检查'}</button>
        <button className="small-button" disabled={!working || !api.cancelOnboarding} onClick={() => api.cancelOnboarding({ workspaceRoot: workspace, platformId })}>停止本次接入</button>
      </>}
      {step === 5 && <>
        <p>治理文档和 Git 记录与检查证据一起保存。只有全部必需步骤通过，才显示“接入完成”。</p>
        <label className="onboarding-field"><span>Git 提交姓名（本机未配置时填写）</span><input value={fields.gitAuthorName || ''} onChange={(event) => field('gitAuthorName', event.target.value)} /></label>
        <label className="onboarding-field"><span>Git 提交邮箱</span><input value={fields.gitAuthorEmail || ''} onChange={(event) => field('gitAuthorEmail', event.target.value)} /></label>
        <button className="small-button" disabled={working || !snapshot?.exists || !api.previewOnboardingGovernancePlan} onClick={() => act(() => api.previewOnboardingGovernancePlan({ workspaceRoot: workspace, platformId }), '治理文档计划已生成。')}>预览治理登记</button>
        <button className="small-button" disabled={working || !snapshot?.exists || !api.readOnboardingState} onClick={() => act(() => api.readOnboardingState({ workspaceRoot: workspace, platformId }))}>查看接入记录与恢复点</button>
        <button className="small-button primary-small" disabled={working || !snapshot?.exists} onClick={() => act(async () => {const state=await api.readOnboardingState({workspaceRoot:workspace,platformId});return api.previewOnboardingFinalizePlan({ workspaceRoot: workspace, platformId,allowPending:state.status==='configured-pending' });}, '入库计划已生成；暂缓项不会因提交而记成接入完成。')}>提交当前配置／核验接入状态</button>
      </>}
      {result && <div className="onboarding-result" role="status"><strong>{result.status==='configured-pending'?'本轮配置已保存 · 接入未完成':result.status || result.stage || (result.stoppedAt ? `停止在：${result.stoppedAt}` : '已返回')}</strong>{(result.steps || []).map((item) => <p key={item.step}>{MODULES[item.step] || item.step}：{item.status==='deferred'?'暂缓':item.status || item.result?.stage || '已返回'} {(item.result?.issues || []).join('；')}</p>)}{(result.pending || []).map(item=><p key={item.step}>{MODULES[item.step] || item.step}：{item.reason}</p>)}{result.pendingSoftware?.length>0 && <p>尚未绑定本体：{result.pendingSoftware.map(item=>item.id).join('、')}。可在“准备环境”的软件绑定区或软件中心补齐。</p>}{result.issues?.map((issue, index) => <p key={index}>{issue}</p>)}{result.readback && <div className="notice"><p>本次接入回读：{result.readback.onboardingVerified?'当前配置与证据一致':'需更新组件或重新验证'}；业务正文未由接入检查执行。</p><p>本次提交未纳入运行产物：{result.readback.privacy.currentCommitPrivateBytesExcluded?'通过':'未确认'}。历史 runtime 入库件：{result.readback.privacy.legacyTrackedCount ?? '未知'} 项，单独登记，不能据此伪造合规通过。</p></div>}<details><summary>证据与读数</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
      <div className="onboarding-footer"><button className="small-button" disabled={step === 0} onClick={() => setStep(step - 1)}>上一步</button><span>{step + 1} / {STEPS.length}</span><button className="small-button" disabled={step === STEPS.length - 1 || !platformId} onClick={() => setStep(step + 1)}>下一步</button></div>
    </>}
  </section>;
}
