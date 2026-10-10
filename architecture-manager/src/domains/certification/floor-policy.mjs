// Full integration always uses the complete three-repository floor. An update
// can additionally attest wf/wfa invocation without claiming external bodies.
export function invocationFloor(report) {
  if(!report || report.unionSourceGaps?.length)return {reached:false,gaps:[],reason:'CAPABILITY_UNION_INCOMPLETE'};
  if(report.floorReached===true)return {reached:true,gaps:[],source:'complete-floor'};
  const rows=(report.verdicts || []).filter(row=>row.kind!=='software' && row.requiredBy?.some(who=>/^(tool|agent):/.test(who)));
  const gaps=rows.filter(row=>row.verdict!=='pass');
  return {reached:rows.length>0 && gaps.length===0,gaps,rows:rows.length,source:'wf-wfa-declarations'};
}

export const floorReachedForScope=(report,scope='full')=>scope==='invocation'?invocationFloor(report).reached:report?.floorReached===true;
