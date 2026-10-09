import fs from 'node:fs';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {runtimeFile} from '../../core/runtime-path.mjs';
import {runScopedProcess,withScopedCleanup} from '../../infrastructure/process-scope.mjs';
import {inspectPlatformConnection} from '../../platform-check.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {validPlatformId} from '../../core/platforms.mjs';
import {sha256} from '../../core/hash.mjs';
import {assertBodyIdentity} from './shared-body.mjs';

export function checkSharedBody({workspaceRoot,platformId,type,resourceId,version}) {
  assertBodyIdentity(resourceId,version);
  if(!['agent','tool'].includes(type) || !validPlatformId(platformId))throw Error('INTAKE_TYPE_INVALID');
  const resource=validateFrozenResource(workspaceRoot,type==='agent'?'agent':'tool',resourceId,version);
  const pre=inspectPlatformConnection({workspaceRoot,platformId}),config=pre.configPath && readJson(pre.configPath);
  if(!config?.interpreters?.['.py'])throw Error('RUNTIME_PYTHON_REQUIRED');
  const ops=config.invocationMatrixRelease || targetPath(workspaceRoot,'tool/architecture-ops/versions/'+readJson(targetPath(workspaceRoot,'tool/architecture-ops/current.json')).version);
  const relative=ops.replaceAll('\\','/');if(!relative.startsWith(workspaceRoot.replaceAll('\\','/').replace(/\/$/,'')+'/tool/architecture-ops/versions/'))throw Error('UNSAFE_PATH');
  validateFrozenResource(workspaceRoot,'tool','architecture-ops',ops.split(/[\\/]/).at(-1));
  const matrix=join(ops,'architecture_ops/invocation_matrix.py'),out=targetPath(workspaceRoot,`${platformId}/runtime/manager-check/body-${randomUUID()}`);fs.mkdirSync(out,{recursive:true});
  const kind=type==='agent'?'agent':'workflow',reportPath=join(out,'matrix.json');let failure=null,report=null,cleanup=null;
  try {runScopedProcess(config.interpreters['.py'],['-B',runtimeFile('matrix_driver.py'),matrix,'--config',pre.configPath,'--out',reportPath,'--runs-root',join(out,'matrix-runs'),'--only',`${kind}:${resourceId}`,'--targets',`${kind}:${resourceId}@${version}`],{encoding:'utf8',timeout:180000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});}
  catch(error){failure=String(error.message);}
  finally {
    if(fs.existsSync(reportPath)){try{report=readJson(reportPath);}catch{/* Empty report is not success. */}}
    if(failure) {try {withScopedCleanup(()=>runScopedProcess(config.interpreters['.py'],['-B',runtimeFile('matrix_cleanup.py'),pre.configPath,out],{encoding:'utf8',timeout:120000}));cleanup=readJson(join(out,'cancel-cleanup.json'));}catch(error){cleanup={ok:false,error:error.message};}}
  }
  const row=report?.rows?.find(row=>row.kind===kind && row.id===resourceId && row.version===version),ok=!failure && report?.rows?.length===1 && row?.status==='PASS';
  const delivery=readBodyDelivery(out,report,resource,type);
  const result={schema:'architecture-manager-body-smoke/v1',platformId,type,resourceId,version,ok:ok && (!delivery || delivery.ok),functionExecuted:false,businessStagesExecuted:false,evidencePath:reportPath,evidenceSha256:fs.existsSync(reportPath)?sha256(fs.readFileSync(reportPath)):null,issues:row?.errorCode?[row.errorCode+': '+row.errorMessage]:failure?[failure]:!ok?['未产生成功调用行']:delivery?.ok===false?['正文或技能上下文未进入领取任务']:[],delivery,cleanup};fs.writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');return result;
}
function readBodyDelivery(out,report,resource,type) {
  if(type!=='agent' || !resource.manifest.bodyPrompt || !report?.runsRoot)return null;
  const runs=targetPath(out,relative(out,report.runsRoot)),promptFiles=[],locks=[];
  for(const entry of fs.readdirSync(runs,{withFileTypes:true})) {
    if(!entry.isDirectory() || !entry.name.startsWith('matrix-'))continue;
    const run=targetPath(runs,entry.name),transactions=join(run,'transactions');
    if(fs.existsSync(join(run,'run-lock.json')))locks.push({path:join(run,'run-lock.json'),sha256:sha256(fs.readFileSync(join(run,'run-lock.json')))});
    if(!fs.existsSync(transactions))continue;
    for(const file of fs.readdirSync(transactions))if(file.endsWith('.json')) {const path=targetPath(transactions,file),receipt=readJson(path);if(receipt.request?.operation==='next' && receipt.response?.result?.task?.prompt)promptFiles.push({path,prompt:receipt.response.result.task.prompt,sha256:sha256(fs.readFileSync(path))});}
  }
  const body=fs.readFileSync(targetPath(resource.directory,resource.manifest.bodyPrompt),'utf8'),contexts=resource.manifest.bodyContexts || [],delivered=promptFiles.find(row=>row.prompt.includes(body) && contexts.every(item=>row.prompt.includes(fs.readFileSync(targetPath(resource.directory,item.entry),'utf8'))));
  return {ok:Boolean(delivered),bodyDelivered:Boolean(delivered),skillContexts:contexts.map(item=>({id:item.id,version:item.version,delivered:Boolean(delivered)})),receiptPath:delivered?.path || null,receiptSha256:delivered?.sha256 || null,locks};
}
