import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJson,inside} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {sha256} from '../../core/hash.mjs';
import {atomicWrite} from '../../transactions/kernel.mjs';
import {resourceKey,stableJson} from './fingerprints.mjs';
import {environmentBinding} from './binding.mjs';
import {legacyBindingAtGit} from './legacy.mjs';

export const matrixSummary=rows=>Object.fromEntries(['PASS','NEEDS-INPUT','EXPECTED','FAIL'].map(status=>[status,rows.filter(row=>row.status===status).length]));
export function ownEvidence(root,id,path,expected=null) {
  if(typeof path!=='string') return false;
  try {
    const checked=targetPath(root,relative(root,path));
    return inside(targetPath(root,`${id}/runtime/manager-check`),checked) && existsSync(checked) && (!expected || sha256(readFileSync(checked))===expected);
  } catch {return false;}
}
function reportValid(report) {
  if(report.schema!=='ai-invocation-matrix/v1' || !report.rows?.length || new Set(report.rows.map(resourceKey)).size!==report.rows.length) return false;
  if(report.rows.some(row=>!['PASS','EXPECTED'].includes(row.status) || !/^(workflow|agent|software)$/.test(row.kind))) return false;
  return report.rows.some(row=>row.status==='PASS') && Object.entries(matrixSummary(report.rows)).every(([key,count])=>report.summary?.[key]===count);
}
export function readCoverage(root,id) {
  const pointerPath=targetPath(root,`${id}/runtime/manager-check/coverage-latest.json`);
  if(!existsSync(pointerPath)) return {status:'missing',coverage:null};
  try {
    const pointer=readJson(pointerPath);
    if(!ownEvidence(root,id,pointer.path,pointer.sha256)) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    const coverage=readJson(pointer.path);
    if(coverage.schema!=='architecture-manager-certification-coverage/v1' || coverage.platformId!==id || !ownEvidence(root,id,coverage.matrixPath,coverage.matrixSha256) || !ownEvidence(root,id,coverage.conformPath,coverage.conformSha256) || !reportValid(readJson(coverage.matrixPath)) || !readJson(coverage.conformPath).floorReached) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    const reports=new Map();
    for(const entry of Object.values(coverage.rows)) {
      if(!ownEvidence(root,id,entry.source.path,entry.source.sha256)) throw Error('CERTIFICATION_EVIDENCE_INVALID');
      if(!reports.has(entry.source.path)) reports.set(entry.source.path,readJson(entry.source.path));
      const row=reports.get(entry.source.path).rows?.find(row=>resourceKey(row)===resourceKey(entry.row) && String(row.version)===String(entry.row.version));
      if(stableJson(row)!==stableJson(entry.row)) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    }
    const anchor=coverage.fullAnchor;
    if(!anchor || !ownEvidence(root,id,anchor.matrixPath || anchor.path,anchor.matrixSha256 || anchor.sha256)) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    const matrix=readJson(coverage.matrixPath);
    if(stableJson(matrix.rows.map(resourceKey).sort())!==stableJson(Object.keys(coverage.rows).sort())) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    for(const row of matrix.rows) if(stableJson(row)!==stableJson(coverage.rows[resourceKey(row)].row)) throw Error('CERTIFICATION_EVIDENCE_INVALID');
    return {status:'valid',coverage,path:pointer.path,sha256:pointer.sha256};
  } catch(error) {return {status:'invalid',coverage:null,error:error.message};}
}
export function legacyCoverage(root,id,previous,snapshot=null) {
  try {
    const proof=previous.firstCertification;
    if(!proof || !['matrix','conform'].every(name=>ownEvidence(root,id,proof[name+'Path'],proof[name+'Sha256']))) return null;
    const report=readJson(proof.matrixPath);
    if(!reportValid(report) || !readJson(proof.conformPath).floorReached) return null;
    let pins=null;
    const configPath=report.runsRoot?join(dirname(report.runsRoot),'config.json'):null;
    if(configPath && ownEvidence(root,id,configPath)) {
      const config=readJson(configPath);pins={};
      for(const key of ['runner','contracts']) {
        if(!inside(targetPath(root,'tool'),config[key])) return null;
        const manifest=readJson(join(config[key],'manifest.json'));pins[key]={version:manifest.version,sha256:sha256(readFileSync(join(config[key],'SHA256SUMS')))};
      }
    }
    // Old positive rows can migrate without re-running a full matrix when the
    // originally recorded complete binding still matches byte for byte. The
    // current frozen resources are independently verified by the snapshot.
    const gitBinding=snapshot?legacyBindingAtGit(root,id,previous,snapshot):null;
    const exactBinding=snapshot && snapshot.configSha256===proof.configSha256 && (previous.environmentBindingSha256===environmentBinding(root,id) || gitBinding) && proof.configSha256===previous.configSha256 && report.rows.every(row=>row.status==='PASS' && row.prepare===true && row.claimed===true && (row.kind==='software'?row.snapshotFrozen===true && row.bodyVerified===true:row.stopped===true));
    const checkedTime=Date.parse(previous.updatedAt || previous.startedAt || proof.checkedAt);
    const rows=Object.fromEntries(report.rows.map(row=>{const key=resourceKey(row),cell=snapshot?.cells[key];const programsUnchanged=(cell?.runtimePrograms || []).every(program=>Number(program.mtime)/1e6<=checkedTime && Number(program.ctime)/1e6<=checkedTime);return [key,{row,source:{path:proof.matrixPath,sha256:proof.matrixSha256},fingerprint:exactBinding && programsUnchanged && (!gitBinding || gitBinding.unchanged.has(key)) && cell?.version===String(row.version)?cell:null}];}));
    return {schema:'architecture-manager-certification-coverage/v1',platformId:id,legacy:true,snapshot:exactBinding?{...snapshot,pins:{...snapshot.pins,...pins}}:pins?{pins}:null,rows,matrixPath:proof.matrixPath,matrixSha256:proof.matrixSha256,conformPath:proof.conformPath,conformSha256:proof.conformSha256,fullAnchor:{kind:'legacy-first-full',matrixPath:proof.matrixPath,matrixSha256:proof.matrixSha256},proof,migratedWithExactBinding:!!exactBinding,sharedMetadataReconstructed:!!gitBinding};
  } catch {return null;}
}
export function writeCoverage(root,id,snapshot,rows,matrixPath,conformPath,fullAnchor) {
  if(!ownEvidence(root,id,matrixPath) || !ownEvidence(root,id,conformPath) || !readJson(conformPath).floorReached || !reportValid(readJson(matrixPath))) throw Error('CERTIFICATION_COVERAGE_INCOMPLETE');
  if(stableJson(Object.keys(rows).sort())!==stableJson(Object.keys(snapshot.cells).sort())) throw Error('CERTIFICATION_COVERAGE_INCOMPLETE');
  const value={schema:'architecture-manager-certification-coverage/v1',platformId:id,snapshot,rows,matrixPath,matrixSha256:sha256(readFileSync(matrixPath)),conformPath,conformSha256:sha256(readFileSync(conformPath)),fullAnchor,environmentBindingSha256:environmentBinding(root,id),checkedAt:new Date().toISOString()};
  const path=join(dirname(matrixPath),'coverage.json');writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const pointer=targetPath(root,`${id}/runtime/manager-check/coverage-latest.json`);
  atomicWrite(pointer,JSON.stringify({path,sha256:sha256(readFileSync(path))},null,2)+'\n',randomUUID());return value;
}
export function mergeCertification(root,id,snapshot,selection,actualPath,conformPath,out) {
  const fresh=actualPath?readJson(actualPath):null;
  const expected=new Set(selection.selected);
  if(fresh && (fresh.rows?.length!==expected.size || fresh.rows.some(row=>!expected.delete(resourceKey(row))) || expected.size || fresh.rows.some(row=>String(row.version)!==snapshot.cells[resourceKey(row)]?.version))) throw Error('CERTIFICATION_SELECTION_MISMATCH');
  const source=actualPath?{path:actualPath,sha256:sha256(readFileSync(actualPath))}:null;
  const actual=new Map((fresh?.rows || []).map(row=>[resourceKey(row),row])),rows={};
  for(const [key,cell] of Object.entries(snapshot.cells)) {
    if(actual.has(key)) rows[key]={row:actual.get(key),fingerprint:cell,source};
    else if(selection.baseline?.rows[key]) rows[key]=selection.baseline.rows[key];
  }
  if(Object.keys(rows).length!==Object.keys(snapshot.cells).length) return null;
  const provenance={actualRows:actual.size,reusedRows:Object.keys(rows).length-actual.size,removedRows:Object.keys(selection.baseline?.rows || {}).filter(key=>!snapshot.cells[key]),sources:[...new Map(Object.values(rows).map(entry=>[entry.source.path,entry.source])).values()],selection:{kind:selection.kind,reasons:selection.reasons},businessStagesExecuted:false};
  const matrix={schema:'ai-invocation-matrix/v1',generatedAt:new Date().toISOString(),rows:Object.values(rows).map(entry=>entry.row),provenance};matrix.summary=matrixSummary(matrix.rows);
  const path=join(out,'matrix.coverage.json');writeFileSync(path,JSON.stringify(matrix,null,2)+'\n',{flag:'wx'});
  if(!reportValid(matrix) || !readJson(conformPath).floorReached || selection.kind==='smoke') return {matrixPath:path,matrix,provenance,coverageComplete:false};
  const coverage=writeCoverage(root,id,snapshot,rows,path,conformPath,selection.baseline?.fullAnchor || {kind:selection.kind,matrixPath:actualPath,matrixSha256:source?.sha256});
  return {matrixPath:path,matrix,provenance,coverageComplete:true,coverage};
}
export function pendingCoverage(root,id,snapshot) {
  try {
    const pendingPath=targetPath(root,`${id}/runtime/manager-check/pending-latest.json`);
    const latestPath=existsSync(pendingPath)?pendingPath:targetPath(root,`${id}/runtime/manager-check/latest.json`);
    if(!existsSync(latestPath)) return null;
    const latest=readJson(latestPath),path=latest.partialPath || latest.matrixActualPath || latest.matrixPath;
    if(!['check-failed','check-cancelled'].includes(latest.stage) || !ownEvidence(root,id,path,latest.partialSha256 || latest.matrixActualSha256 || latest.matrixSha256) || !ownEvidence(root,id,latest.scopeSnapshotPath,latest.scopeSnapshotSha256)) return null;
    const prior=readJson(latest.scopeSnapshotPath),report=readJson(path),source={path,sha256:sha256(readFileSync(path))};
    if(!report.rows?.length || prior.snapshot?.platformId!==id || !['full','resume-first','incremental'].includes(prior.selection?.kind)) return null;
    const rows={};
    for(const [key,entry] of Object.entries(prior.baselineRows || {})) if(ownEvidence(root,id,entry.source.path,entry.source.sha256) && stableJson(entry.fingerprint)===stableJson(snapshot.cells[key])) rows[key]=entry;
    for(const row of report.rows) {const key=resourceKey(row),before=prior.snapshot.cells[key],next=snapshot.cells[key];if(['PASS','EXPECTED'].includes(row.status) && before && next && prior.snapshot.rulesSha256===snapshot.rulesSha256 && stableJson(before)===stableJson(next)) rows[key]={row,source,fingerprint:next};}
    return Object.keys(rows).length?{resumeFirst:prior.selection.kind!=='incremental',snapshot:prior.snapshot,rows,fullAnchor:prior.fullAnchor || {kind:'first-full-resumed',path,sha256:source.sha256}}:null;
  } catch {return null;}
}
