import React,{useEffect,useState} from 'react';
import {friendlyError} from '../../presenter.mjs';
const statuses={prepared:'待执行',validated:'已校验，待发布','body-staged':'本体与恢复演练已完成，待发布配方','released-awaiting-registration':'冻结版本保留，登记未完成',interrupted:'已中断，可继续',complete:'当前导入步骤完成（业务未执行）',reverted:'已撤销登记，版本及本体备份保留',unreadable:'记录不可读'};
export function ImportHistoryPanel({api,workspace,platformId,setPlanPreview,setPlanPayload,setMessage}) {
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[page,setPage]=useState(0);
  const refresh=async()=>{if(!workspace || !platformId){setRows([]);return;}try{setRows(await api.listIntakeJournals({workspaceRoot:workspace,platformId}));setError('');}catch(error){setError(friendlyError(error));}};
  useEffect(()=>{let active=true;if(workspace && platformId)api.listIntakeJournals({workspaceRoot:workspace,platformId}).then(value=>{if(active){setRows(value);setPage(0);}}).catch(error=>{if(active)setError(friendlyError(error));});else setRows([]);return ()=>{active=false;};},[api,workspace,platformId]);
  const preview=async(row,revert)=>{
    try {
      const input={workspaceRoot:workspace,platformId,planId:row.planId};
      const plan=revert?await api.previewIntakeRevertPlan(input):(await api.readIntakeJournal(input)).plan;
      setPlanPreview(plan);setPlanPayload(null);setMessage(revert?'已生成撤销登记计划；冻结版本、本体和备份保留。':'已恢复原导入计划；确认后核对来源并只补未完成步骤。');
    } catch(error){setError(friendlyError(error));}
  };
  return <section className="panel"><div className="panel-title"><span>导入记录与恢复</span><button className="small-button" disabled={!workspace || !platformId} onClick={refresh}>重新读取记录</button></div>
    {error && <div className="scan-result warning" role="alert">{error}</div>}
    {!rows.length && <p className="muted">选择所属平台后显示它的导入记录。中断继续使用同一计划，不重新安装或重复发布。</p>}
    {rows.slice(page*50,(page+1)*50).map(row=><div className="resource-row" key={row.planId}><div><strong>{row.resourceId || row.planId}</strong> · {row.version}<p>{statuses[row.status] || row.status}</p>{row.error && <p>{friendlyError(Error(row.error))}</p>}</div><div className="git-actions"><button className="small-button" disabled={['complete','reverted','unreadable'].includes(row.status)} onClick={()=>preview(row,false)}>继续原计划</button><button className="small-button" disabled={['reverted','unreadable'].includes(row.status)} onClick={()=>preview(row,true)}>预览撤销登记</button></div></div>)}
    {rows.length>50 && <div className="git-actions"><button className="small-button" disabled={!page} onClick={()=>setPage(value=>value-1)}>上一页</button><span>{page+1}/{Math.ceil(rows.length/50)}</span><button className="small-button" disabled={(page+1)*50>=rows.length} onClick={()=>setPage(value=>value+1)}>下一页</button></div>}
  </section>;
}
