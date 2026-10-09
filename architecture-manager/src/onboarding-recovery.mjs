import {parseJson as parseJsonText} from './core/json.mjs';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { targetPath } from './core/paths.mjs';
import { inside } from './core/json.mjs';
import { sha256 } from './core/hash.mjs';

const read=path=>parseJsonText(readFileSync(path,'utf8'));
const hash=path=>sha256(readFileSync(path));
const rowKey=row=>`${row.kind}:${row.id}@${row.version}`;
const blocked=row=>['FAIL','NEEDS-INPUT'].includes(row.status);
const summary=rows=>Object.fromEntries(['PASS','NEEDS-INPUT','EXPECTED','FAIL'].map(status=>[status,rows.filter(row=>row.status===status).length]));
function own(root,id,path) {
  if(typeof path!=='string') return false;
  const checked=targetPath(root,relative(root,resolve(path)));
  return inside(targetPath(root,`${id}/runtime/manager-check`),checked) && existsSync(checked);
}

export function pendingFirstMatrix(previous,root,id,binding,environmentHash) {
  if(!['configSha256','versionsSha256','adapterSha256'].every(key=>previous[key]===binding[key]) || previous.environmentBindingSha256!==environmentHash) return null;
  const saved=previous.pendingMatrixRecovery;
  if(saved) {
    if(!own(root,id,saved.matrixPath) || !own(root,id,saved.conformPath) || hash(saved.matrixPath)!==saved.matrixSha256 || hash(saved.conformPath)!==saved.conformSha256) throw new Error('ONBOARDING_RESUME_DRIFT');
    const failed=read(saved.matrixPath).rows.filter(blocked);
    if(JSON.stringify(failed.map(rowKey))!==JSON.stringify(saved.failedKeys) || saved.only!==failed.map(row=>`${row.kind}:${row.id}`).join(',')) throw new Error('ONBOARDING_RESUME_DRIFT');
    return saved;
  }
  const step=previous.steps?.findLast(item=>item.step==='conform-and-first-matrix' && item.status==='failed');
  const result=step?.result;
  if(!result || result.platformId!==id || !own(root,id,step.evidencePath) || hash(step.evidencePath)!==step.evidenceSha256 || !own(root,id,result.matrixPath) || !own(root,id,result.conformPath)) return null;
  const matrix=read(result.matrixPath),floor=read(result.conformPath);
  if(matrix.schema!=='ai-invocation-matrix/v1' || !Array.isArray(matrix.rows) || !matrix.rows.length || !floor.floorReached || !matrix.rows.some(row=>row.status==='PASS')) return null;
  if(new Set(matrix.rows.map(rowKey)).size!==matrix.rows.length || Object.entries(summary(matrix.rows)).some(([status,count])=>matrix.summary?.[status]!==count)) return null;
  const failed=matrix.rows.filter(blocked);
  if(!failed.length || failed.some(row=>!['workflow','agent','software'].includes(row.kind) || !/^[a-z0-9][a-z0-9._-]*$/.test(row.id) || typeof row.version!=='string')) return null;
  return {matrixPath:result.matrixPath,matrixSha256:hash(result.matrixPath),conformPath:result.conformPath,conformSha256:hash(result.conformPath),only:failed.map(row=>`${row.kind}:${row.id}`).join(','),failedKeys:failed.map(rowKey),...binding,environmentBindingSha256:environmentHash};
}

export function mergeFirstMatrix(recovery,patch,root,id) {
  if(hash(recovery.matrixPath)!==recovery.matrixSha256 || hash(recovery.conformPath)!==recovery.conformSha256) throw new Error('ONBOARDING_RESUME_DRIFT');
  if(patch.issues?.length || patch.counts?.fail || patch.counts?.needsInput || patch.configSha256!==recovery.configSha256 || !own(root,id,patch.matrixPath) || !own(root,id,patch.conformPath)) throw new Error('ONBOARDING_CHECK_FAILED');
  const base=read(recovery.matrixPath),fresh=read(patch.matrixPath),floor=read(patch.conformPath);
  const replacement=new Map((fresh.rows || []).map(row=>[rowKey(row),row]));
  if(!floor.floorReached || replacement.size!==recovery.failedKeys.length || (fresh.rows || []).length!==replacement.size || recovery.failedKeys.some(key=>replacement.get(key)?.status!=='PASS') || [...replacement.keys()].some(key=>!recovery.failedKeys.includes(key))) throw new Error('ONBOARDING_CHECK_FAILED');
  const rows=base.rows.map(row=>replacement.get(rowKey(row)) || row);
  const provenance={base:{path:recovery.matrixPath,sha256:recovery.matrixSha256},patch:{path:patch.matrixPath,sha256:hash(patch.matrixPath)},retainedRows:rows.length-replacement.size,retestedRows:replacement.size,configSha256:recovery.configSha256,versionsSha256:recovery.versionsSha256,environmentBindingSha256:recovery.environmentBindingSha256,businessStagesExecuted:false};
  const directory=targetPath(root,`${id}/runtime/manager-check/recovered-${randomUUID()}`);mkdirSync(directory);
  const matrixPath=join(directory,'matrix.json');
  const matrix={...base,generatedAt:new Date().toISOString(),summary:summary(rows),rows,recovery:provenance};
  writeFileSync(matrixPath,JSON.stringify(matrix,null,2)+'\n',{flag:'wx'});
  const result={...patch,mode:'full-recovered',matrixPath,matrixSha256:hash(matrixPath),conformSha256:hash(patch.conformPath),counts:{pass:matrix.summary.PASS,fail:matrix.summary.FAIL,needsInput:matrix.summary['NEEDS-INPUT'],expected:matrix.summary.EXPECTED,conform:floor.counts},recovery:provenance,evidencePath:join(directory,'check.json'),evidenceFresh:false};
  writeFileSync(result.evidencePath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return result;
}
