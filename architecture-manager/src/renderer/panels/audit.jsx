import React, {useEffect,useRef,useState} from 'react';

const STATUS={started:'开始执行',completed:'执行返回',applied:'已应用','already-applied':'重复确认，未重复执行',blocked:'被拒绝',failed:'执行失败',cancelled:'已取消'};
export function AuditPanel({api,workspace}) {
  const [audit,setAudit]=useState(null),[error,setError]=useState(null),[status,setStatus]=useState(''),[planId,setPlanId]=useState(''),[workspaceOnly,setWorkspaceOnly]=useState(true);
  const request=useRef(0);
  const load=()=>{
    const version=++request.current;setError(null);
    api.readAuditEvents({limit:100,workspaceRoot:workspaceOnly?workspace:null,status:status || null,planId:planId || null,verifyCheckpoints:true}).then(data=>{if(version===request.current)setAudit(data);}).catch(e=>{if(version===request.current)setError(String(e?.message ?? e));});
  };
  useEffect(()=>{setAudit(null);load();return()=>{request.current++;};},[workspace,status,workspaceOnly]);
  return <section className="panel"><div className="panel-title"><span>审计历史与完整性检查</span><button className="small-button" onClick={load}>刷新并核对</button></div>
    <p>记录确认执行的开始、结果、失败和重试关联；不会重跑操作。未知写入结果会明确标记，旧记录不补造时间或封条。</p>
    <div className="wizard-grid"><label>状态<select value={status} onChange={event=>setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>计划或操作 ID<input value={planId} onChange={event=>setPlanId(event.target.value)} placeholder="输入后点击刷新并核对" /></label><label><input type="checkbox" checked={workspaceOnly} onChange={event=>setWorkspaceOnly(event.target.checked)} />仅当前工作区</label></div>
    {error && <div className="scan-result warning" role="alert">读取失败：{error}</div>}
    {!audit && !error && <div className="empty">正在读取审计事件……</div>}
    {audit && !audit.present && <div className="empty">尚无本机审计记录。</div>}
    {audit?.present && <>
      <div className="muted">全部 {audit.totalEvents} 条有效事件 · 当前筛选 {audit.matchedEvents} 条 · 显示最近 {audit.events.length} 条 · checkpoint {audit.checkpointCount} 个</div>
      {audit.operationsWithoutTerminal?.length>0 && <p className="scan-result warning">{audit.operationsWithoutTerminal.length} 次操作尚无最终记录：可能仍在执行或已中断，请回读实际状态；不能当作成功或零写入。</p>}
      <div className={audit.ok?'scan-result clean':'scan-result warning'}>事件结构与封条：{audit.ok?'未发现不一致':'发现待核对问题'}；坏 JSON {audit.corruptLines}，非事件 {audit.invalidEvents}，事件封条不符 {audit.integrity.mismatches}，本次所示 checkpoint 问题 {audit.integrity.checkpointProblems}。</div>
      {(audit.integrity.legacyUnsealed>0 || audit.integrity.missingTimestamps>0) && <p>历史未封条 {audit.integrity.legacyUnsealed} 条、未记录时间 {audit.integrity.missingTimestamps} 条；可阅读历史，不能据此证明完整性。封条不等于防止有权限者改写整个日志。</p>}
      <div className="rows">{audit.events.slice().reverse().map((event,index)=><div className="row" key={`${event.transactionId || 'legacy'}:${event.occurredAt || ''}:${index}`}><div>
        <span className="row-name">{event.action}</span><span className={['applied','completed','already-applied'].includes(event.status)?'pill good':'pill warn'}>{STATUS[event.status] || event.status}</span>
        <div className="path-line">{event.occurredAt || '时间未记录'} · {event.target || '未记录目标'}</div>
        <div className="path-line">计划：{event.planId || '未记录'} · 操作：{event.operationId || '历史未关联'}{event.parentOperationId?' · 父操作：'+event.parentOperationId:''}</div>
        <details><summary>哈希、恢复点与错误</summary><p>阶段：{event.phase || '历史'}；事件：{event.integrity.checksum}；恢复点：{event.integrity.checkpoint}</p><p className="path-line">{event.checkpointPath || '无恢复点路径'}</p><p>{event.error || '无错误记录'}{event.sensitiveRedacted?'（展示已脱敏）':''}</p><p className="path-line">旧：{event.oldSha256 || '未记录'}<br />新：{event.newSha256 || '未记录'}</p></details>
      </div><span className={event.writeState==='unknown' || event.writePerformed===true?'pill warn':'pill'}>{event.writeState==='unknown' || event.writePerformed==null?'写入结果未知':event.writePerformed?'已写入':'未写入'}</span></div>)}</div>
    </>}
  </section>;
}
