import React,{useEffect,useState} from 'react';
import {SchemaFields} from '../../shared/SchemaFields.jsx';
import {convertFields} from '../../shared/schema-fields.mjs';
import {friendlyError} from '../../presenter.mjs';
export function SoftwareActionsPanel({api,workspace,platformId,softwareId,setPlanPreview,setPlanPayload,setMessage}) {
  const [details,setDetails]=useState(null),[selected,setSelected]=useState(''),[values,setValues]=useState({}),[error,setError]=useState(''),[references,setReferences]=useState('');
  useEffect(()=>{let active=true;setDetails(null);setError('');if(softwareId)api.readSoftwareBodyActions({workspaceRoot:workspace,softwareId,platformId}).then(value=>{if(active){setDetails(value);setSelected(value.actions[0]?.name || '');setValues({});setReferences((value.requiredReferences || []).join('\n'));}}).catch(error=>{if(active)setError(friendlyError(error));});return ()=>{active=false;};},[api,workspace,platformId,softwareId]);
  const action=details?.actions.find(row=>row.name===selected);
  const preview=async operation=>{setError('');try{const arguments_=convertFields(action?.inputSchema || {type:'object'},values) || {};const plan=await api.previewSoftwareCommand({workspaceRoot:workspace,platformId,softwareId,operation,capability:selected,arguments:arguments_,credentialReferences:references.split(/\r?\n/).filter(Boolean)});setPlanPreview(plan);setPlanPayload(null);setMessage('软件动作计划已生成；确认后经所选平台的连接器调用。');}catch(error){setError(friendlyError(error));}};
  if(!softwareId)return null;
  return <section className="panel"><div className="panel-title"><span>{softwareId}：功能与本次会话</span><span className="muted">{details?.version || ''}</span></div><p>所属平台：{platformId || '请先选择平台'}。启动、存活与具体功能测试分别记录；关闭只针对管理台本次登记的会话。</p>
    {details && <><select value={selected} onChange={event=>{setSelected(event.target.value);setValues({});}}>{details.actions.map(row=><option key={row.name} value={row.name}>{row.nativeName || row.name} · {row.observed?'有冻结证据':'待验证'}</option>)}</select>
      {action && <SchemaFields key={selected} schema={action.inputSchema} value={values} onChange={setValues} />}
      <label className="wizard-field">凭据引用（每行一个 reference:名称；不填写密码）<textarea rows={2} value={references} onChange={event=>setReferences(event.target.value)} /></label>
      <div className="git-actions"><button className="primary-small" disabled={!platformId || !selected || action?.observed===false} onClick={()=>preview('call')}>预览调用这个功能</button>{['open','status','close'].map(operation=><button className="small-button" key={operation} disabled={!platformId} onClick={()=>preview(operation)}>{({open:'预览启动',status:'预览检查存活',close:'预览关闭'})[operation]}</button>)}</div></>}
    {error && <div className="scan-result warning" role="alert">{error}</div>}
  </section>;
}
