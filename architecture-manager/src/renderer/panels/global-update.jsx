import React,{useEffect,useRef,useState} from 'react';
import {friendlyError} from '../presenter.mjs';

const labels={complete:'更新并验证通过','no-change':'无变化',pending:'待补','validated-awaiting-push':'已验证，待推送',stopped:'已停止',restored:'已恢复旧接入配置','failed-restored':'失败，已恢复','external-change':'外部变化需核对','not-started':'尚未开始'};
export function GlobalUpdatePanel({api,workspace,inventory,busy,setPlanPreview,setPlanPayload,setMessage}) {
  const [settings,setSettings]=useState({}),[push,setPush]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[previous,setPrevious]=useState(null),[result,setResult]=useState(null),[preflight,setPreflight]=useState(null);
  const scope=useRef(workspace);scope.current=workspace;
  useEffect(()=>{setSettings({});setPrevious(null);setResult(null);setError('');setPush(false);setPreflight(null);},[workspace]);
  useEffect(()=>{let active=true;if(workspace)api.readGlobalUpdateHistory({workspaceRoot:workspace}).then(value=>{if(active&&value){setPrevious(value.plan);setResult(value.result);}}).catch(()=>{});return()=>{active=false;};},[workspace,api]);
  useEffect(()=>{
    const receive=event=>{if(event.detail.workspaceRoot===workspace){setPrevious(event.detail.plan);setResult(event.detail.result);}};
    window.addEventListener('global-update-result',receive);return()=>window.removeEventListener('global-update-result',receive);
  },[workspace]);
  const field=(id,key,value)=>setSettings(old=>({...old,[id]:{...old[id],[key]:value}}));
  const preview=async(mode='new')=>{
    const origin=workspace;setWorking(true);setError('');
    try {
      const plan=mode==='restore'?await api.previewGlobalUpdateRestore({workspaceRoot:workspace,updatePlan:previous}):await api.previewGlobalUpdate({workspaceRoot:workspace,settings,push,...(mode==='resume'?{resumePlan:previous}:{})});
      if(scope.current!==origin)return;
      if(mode!=='restore') {
        setPreflight(plan.payload.preflight || []);
        if(plan.payload.platforms.some(row=>row.pending.some(code=>/^CONTEXT_WINDOW/.test(code)))) {setError('请在下方补填缺少的有效上下文窗口和来源，再点击一键更新重新生成计划。');return;}
      }
      setPlanPreview(plan);setPlanPayload(null);setMessage(mode==='restore'?'旧接入配置恢复计划已生成，请核对后执行。':`已有有效配置的平台更新计划已生成：${plan.target.platformIds.length} 个目标；一次确认后依次执行。`);
    }catch(value){if(scope.current===origin)setError(friendlyError(value));}finally{if(scope.current===origin)setWorking(false);}
  };
  return <section className="panel global-update-panel"><div className="panel-title"><span>所有平台的三仓接入更新</span><button className="primary-small small-button" disabled={!workspace||busy||working} onClick={()=>preview()}>一键更新所有平台</button></div>
    <p>自动纳入已有有效接入配置的平台，统一核对目标后依次更新。各平台分别保存验证与恢复记录，未配置者列为跳过。配置更新、能力地板和厂商原生工具验证分别记录。</p>
    <label className="sensitive-confirm"><input type="checkbox" checked={push} disabled={busy||working} onChange={event=>setPush(event.target.checked)} />本次同时正常推送已配置的 Git 远端；未推送时保留“已验证，待推送”</label>
    <details open={preflight?.some(row=>row.pending.some(code=>/^CONTEXT_WINDOW/.test(code))) || undefined}><summary>必要补填与保留个人固定版本</summary>{inventory?.platforms?.map(row=><div className="wizard-grid" key={row.id}><strong>{row.displayName||row.id}</strong><span>{preflight?.find(item=>item.platformId===row.id)?.pending.map(code=>friendlyError(code)).join('；') || ''}</span><label>有效上下文窗口<input type="number" min="1" placeholder={String(preflight?.find(item=>item.platformId===row.id)?.contextWindowTokens || '沿用本平台已声明值')} value={settings[row.id]?.contextWindowTokens||''} onChange={event=>field(row.id,'contextWindowTokens',event.target.value)} /></label><label>窗口来源<input value={settings[row.id]?.contextWindowSource||''} placeholder={preflight?.find(item=>item.platformId===row.id)?.contextWindowSource || '模型配置或用户确认'} onChange={event=>field(row.id,'contextWindowSource',event.target.value)} /></label><label>资源工具 Python<input value={settings[row.id]?.pythonExecutable||''} placeholder="沿用本平台解释器；缺库版本不兼容时补填" onChange={event=>field(row.id,'pythonExecutable',event.target.value)} /></label><label>保留的个人固定资源<input value={(settings[row.id]?.retain||[]).join(',')} placeholder="agent:资源ID,tool:资源ID" onChange={event=>field(row.id,'retain',event.target.value.split(',').map(value=>value.trim()).filter(Boolean))} /></label></div>)}</details>
    {error&&<div role="alert" className="notice">{error}</div>}
    {result&&<><div className="rows">{result.results?.map(row=><div className="row" key={row.platformId}><strong>{row.platformId}</strong><span>{labels[row.status]||row.status}</span><span>{row.error?friendlyError(row.error):(row.pending||[]).map(code=>friendlyError(code)).join('；')}<br />配置：{row.activated?'已更新':'未更新'}；能力地板：{row.check?.coverageComplete===true?'有验证记录':'待验证'}；厂商原生工具：{row.native?.nativeVendorClientVerified?'有真回执':'待验证'}</span></div>)}{result.skipped?.map(row=><div className="row" key={row.platformId}><strong>{row.platformId}</strong><span>跳过，先完成原接入向导：{friendlyError(row.reason)}</span></div>)}</div><div className="git-actions"><button className="small-button" disabled={busy||working} onClick={()=>preview('resume')}>继续本次更新</button><button className="small-button" disabled={busy||working} onClick={()=>preview('restore')}>恢复本次旧接入配置</button></div></>}
  </section>;
}
