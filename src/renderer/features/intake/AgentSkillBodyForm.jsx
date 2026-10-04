import {useSelectionApi} from '../../shared/useSelectionApi.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {friendlyError} from '../../presenter.mjs';
const start={resourceId:'',version:'1.0.0',displayName:'',role:'',runnerWorkflow:'',dependencies:{workflows:{},skills:{},packs:{},profiles:{}},requires:[]};
export function AgentSkillBodyForm({api,workspace,platformId,intake=null,resource=null,setPlanPreview,setPlanPayload,setMessage,onClose=null}) {
  api=useSelectionApi(api,workspace+":"+platformId+":"+(intake?.sourceFingerprint || resource?.resourceId || ""));
  const [editor,setEditor]=useState(null),[fields,setFields]=useState(start),[text,setText]=useState(''),[options,setOptions]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false),[filter,setFilter]=useState('');
  const serial=useRef(0),type=intake?.type || resource?.type;
  useEffect(()=>{
    const current=++serial.current;setEditor(null);setError('');
    if(!intake?.selectedEntry && !resource)return;
    Promise.all([api.readBodyEditor({workspaceRoot:workspace,platformId,intake,...resource}),api.listBodyDependencies({workspaceRoot:workspace})]).then(([value,choices])=>{
      if(current!==serial.current)return;
      const next={...start,...value.fields,dependencies:{...start.dependencies,...value.fields.dependencies}};
      if(type==='agent' && !value.fields.updating) {const workflow=choices.workflows.find(row=>row.id==='expert-task') || choices.workflows[0];if(workflow){next.runnerWorkflow=workflow.id;next.dependencies={...next.dependencies,workflows:{[workflow.id]:workflow.version}};}}
      setEditor(value);setText(value.content);setFields(next);setOptions(choices);
    }).catch(error=>{if(current===serial.current)setError(friendlyError(error));});
    return ()=>{serial.current++;};
  },[api,workspace,platformId,intake,resource,type]);
  const update=(key,value)=>setFields(previous=>({...previous,[key]:value}));
  const pin=(section,row,enabled)=>setFields(previous=>{const mapping={...previous.dependencies[section]};if(enabled)mapping[row.id]=row.version;else delete mapping[row.id];return {...previous,dependencies:{...previous.dependencies,[section]:mapping}};});
  const preview=async()=>{
    setWorking(true);setError('');
    try {const plan=await api.previewAgentSkillBody({intake:editor.intake,platformId,...fields,content:text,existingManifest:editor.fields.manifest});setPlanPreview(plan);setPlanPayload(null);setMessage('接入计划已生成。确认后发布独立的新版本；正文和依赖尚未执行。');}
    catch(error){setError(friendlyError(error));}finally{setWorking(false);}
  };
  return <section className="panel agent-skill-form"><div className="panel-title"><span>{resource?'编辑并发布新版本':'正文与接入设置'} · {type==='agent'?'专家':'技能'}</span>{onClose && <button className="small-button" onClick={onClose}>关闭编辑</button>}</div>
    {error && <div className="scan-result warning" role="alert">{error}</div>}
    {!editor?<p>正在读取完整正文…{!intake?.selectedEntry && !resource?'请先选择正文入口。':''}</p>:<>
      <div className="wizard-grid">
        <div className="wizard-field"><label>资源 ID（英文，用于引用）</label><input value={fields.resourceId} readOnly={fields.updating} onChange={event=>update('resourceId',event.target.value)} placeholder="my-expert / my-skill" /></div>
        <div className="wizard-field"><label>显示名称</label><input value={fields.displayName} onChange={event=>update('displayName',event.target.value)} placeholder="中文名称" /></div>
        <div className="wizard-field"><label>新版本</label><input value={fields.version} onChange={event=>update('version',event.target.value)} placeholder="1.0.0" /><small>旧版保留；确认后成为当前默认。</small></div>
        {type==='agent' && <><div className="wizard-field"><label>职责</label><input value={fields.role} onChange={event=>update('role',event.target.value)} /></div><div className="wizard-field"><label>主工作流（已发布的精确版本）</label><select value={fields.runnerWorkflow} onChange={event=>{const row=options.workflows.find(row=>row.id===event.target.value);update('runnerWorkflow',row?.id || '');if(row)pin('workflows',row,true);}}><option value="">请选择</option>{options.workflows.map(row=><option key={row.id} value={row.id}>{row.displayName} · {row.id}@{row.version}</option>)}</select></div></>}
      </div>
      <div className="wizard-field"><label>完整正文（可编辑；原件完整保留）</label><textarea rows={16} value={text} onChange={event=>setText(event.target.value)} spellCheck={false} /></div>
      <details><summary>精确依赖与环境需求</summary><p>环境归所属平台 runtime，正文不会触发安装或业务执行。</p><input className="filter-input" value={filter} onChange={event=>setFilter(event.target.value)} placeholder="筛选依赖 ID（每类显示 50 个）" />
        {['workflows','skills','packs',...(type==='skill'?['software']:[])].map(section=><div key={section}><strong>{({workflows:'工作流',skills:'技能',packs:'能力包',software:'软件配方'})[section]}</strong><div className="dependency-list">{options[section].filter(row=>!filter || row.id.includes(filter)).slice(0,50).map(row=><label key={row.id}><input type="checkbox" checked={Boolean(fields.dependencies[section]?.[row.id])} onChange={event=>pin(section,row,event.target.checked)} disabled={section==='workflows' && row.id===fields.runnerWorkflow} />{row.id}@{row.version}</label>)}</div><p className="path-line">已锁定：{Object.entries(fields.dependencies[section] || {}).map(([id,pin])=>id+'@'+pin).join('、') || '无'}</p></div>)}
        {type==='skill' && <div className="wizard-field"><label>解释器／库需求（每行一条，可留空）</label><textarea rows={3} value={fields.requires.join('\n')} onChange={event=>update('requires',event.target.value.split(/\r?\n/).filter(line=>line.trim()))} placeholder="python>=3.8" /></div>}
      </details>
      <div className="git-actions"><button className="primary-small" disabled={working || !platformId || !fields.resourceId || !text.trim() || type==='agent' && !fields.runnerWorkflow} onClick={preview}>{working?'核对来源与依赖…':'预览接入／更新'}</button></div>
      <p className="muted">发布并登记后可在资源页启用、停用或切回旧版本。最小调用只检查准备、领取与停止，不替你执行正文任务。</p>
    </>}
  </section>;
}
