export function selectDeclaredEntry(type,choices,manifest=null){
  const has=value=>typeof value==='string'&&choices.some(row=>row.path===value);
  const declared=type==='agent'?manifest?.prompt:type==='tool'?manifest?.entry:null;
  if(has(declared))return declared;
  const canonical={agent:/(^|\/)prompt\.md$/i,tool:/(^|\/)workflow\.(yaml|yml|json)$/i,skill:/(^|\/)SKILL\.md$/i}[type];
  const matching=canonical?choices.filter(row=>canonical.test(row.path)):[];
  return matching.length===1?matching[0].path:choices.length===1?choices[0].path:null;
}
