import {readJson} from '../../core/json.mjs';
import {existsSync} from 'node:fs';
import {targetPath} from '../../core/paths.mjs';
import {stableJson} from './fingerprints.mjs';
import {readCoverage,legacyCoverage,pendingCoverage} from './evidence.mjs';

const generation=version=>{const [major,minor]=String(version).split('.');return major==='0'?'0.'+minor:major;};
export function selectCertification(snapshot,baseline,{mode='full',only=null,baselineStatus='missing'}={}) {
  const selected=new Set(),reasons={},keys=Object.keys(snapshot.cells);
  const add=(key,reason)=>{selected.add(key);(reasons[key] ||= []).push(reason);};
  const generationChanged=baseline?.snapshot && ['runner','contracts'].some(key=>generation(snapshot.pins[key].version)!==generation(baseline.snapshot.pins[key].version));
  if(generationChanged) baseline=null;
  let kind;
  if(!baseline) {
    kind=generationChanged || mode==='full' && !only?'full':'smoke';
    if(kind==='full') for(const key of keys) add(key,baselineStatus==='invalid'?'原证据损坏；无有效首检':'首次接入或引擎／契约大版本');
  } else {
    kind=baseline.resumeFirst?'resume-first':'incremental';
    for(const key of keys) {
      const before=baseline.rows[key],next=snapshot.cells[key];
      if(!before) add(key,'新接入或首次尚未完成的资源');
      else if(String(before.row.version)!==next.version) add(key,'正在使用的版本改变');
      else if(!before.fingerprint) add(key,'旧证据未保存可复算的影响指纹；本格待迁移');
      else {
        if(before.fingerprint.resourceSha256!==next.resourceSha256) add(key,'正文、锁或依赖内容改变');
        if(before.fingerprint.configurationSha256!==next.configurationSha256) add(key,'相关配置、Profile、provider 或环境改变');
        if((before.fingerprint.rulesSha256 || baseline.snapshot.rulesSha256)!==snapshot.rulesSha256) add(key,'验证规则改变');
        if(!['PASS','EXPECTED'].includes(before.row.status)) add(key,'上次未通过');
      }
    }
    if(baseline.snapshot && stableJson(baseline.snapshot.pins.runner)!==stableJson(snapshot.pins.runner)) {
      const representative=keys.includes('workflow:expert-task')?'workflow:expert-task':keys[0];if(representative) add(representative,'引擎补丁代表格');
    }
  }
  if(only) {
    for(const token of only.split(',').map(value=>value.trim()).filter(Boolean)) {
      const matches=keys.filter(key=>token===key || token===key.split(':')[1] || token===key.split(':')[0] || token===key.split(':')[0]+':*');
      if(!matches.length) throw Error('CERTIFICATION_EMPTY_SELECTION:'+token);
      for(const key of matches) add(key,'用户点名');
    }
  } else if(mode==='quick') {
    const representative=keys.includes('workflow:expert-task')?'workflow:expert-task':keys[0];if(representative) add(representative,'用户请求实测代表格');
  }
  if(!keys.length || (!selected.size && !baseline)) throw Error('CERTIFICATION_EMPTY_SELECTION');
  return {kind,mode:kind==='full'?'full':'quick',selected:[...selected],only:[...selected].join(','),baseline,reasons,removed:Object.keys(baseline?.rows || {}).filter(key=>!snapshot.cells[key]),reused:keys.filter(key=>!selected.has(key))};
}
export function certificationSelection(root,id,snapshot,options={}) {
  const saved=readCoverage(root,id);
  let baseline=saved.coverage;
  const pending=pendingCoverage(root,id,snapshot);
  if(baseline && pending) baseline=pending.resumeFirst?pending:{...baseline,rows:{...baseline.rows,...pending.rows}};
  if(saved.status==='missing') {
    const statePath=targetPath(root,`${id}/runtime/maintenance/manager-onboarding/state.json`);
    let previous={};try {if(existsSync(statePath)) previous=readJson(statePath);} catch { /* invalid old state is not proof */ }
    baseline=legacyCoverage(root,id,previous,snapshot) || pending;
  }
  return selectCertification(snapshot,baseline,{...options,baselineStatus:saved.status});
}
