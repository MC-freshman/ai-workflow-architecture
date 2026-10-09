import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runnerConfig} from '../../software-publish.mjs';
import {targetPath} from '../../core/paths.mjs';
import {parseJson} from '../../core/json.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {runOwnedProcess} from '../../core/owned-process.mjs';

export async function connectorHealth(workspaceRoot,softwareId,platformId,{relay=null,registerCancel=()=>{},onProgress=()=>{}}={}) {
  if(!platformId) throw Error('PLATFORM_CONFIGURATION_REQUIRED');
  const connector=runnerConfig(workspaceRoot,platformId),bodyPath=connector.value.bodies?.[softwareId];
  if(!bodyPath) return {id:softwareId,platformId,bodyPath:null,status:'SOFTWARE_NOT_DECLARED',dispatchable:false,writePerformed:false};
  const runtime=platformPython(workspaceRoot,platformId);
  const request={schema:'ai-software-admin/v1',kind:'request',operation:'software.health',softwareId};
  const cwd=targetPath(workspaceRoot,`${platformId}/runtime/tmp/manager-health/${randomUUID()}`);
  onProgress({platformId,phase:'核对所选平台的本体与快照'});
  const run=relay || (spec=>runOwnedProcess({...spec,registerCancel}));
  const result=await run({python:runtime.python,args:['-B',connector.gatewayPath,'--config',connector.path],input:JSON.stringify(request),cwd,timeout:30000});
  if(result.cancelled) throw Error('ONBOARDING_CANCELLED');
  if(result.timedOut) throw Error('SOFTWARE_HEALTH_TIMEOUT');
  if(result.exitCode!==0) throw Error('SOFTWARE_CONNECTOR_FAILED');
  const response=parseJson(result.stdout),row=response.result?.software?.find(item=>item.softwareId===softwareId);
  if(response.ok!==true || !row) throw Error('SOFTWARE_CONNECTOR_INVALID');
  return {id:softwareId,platformId,bodyPath,bodyExists:existsSync(bodyPath),status:row.dispatchable===true?'READY':row.blocking?.[0]?.code || 'HEALTH_CHECK_FAILED',dispatchable:row.dispatchable===true,details:row,description:row.dispatchable?'本体与冻结快照匹配，已具备声明的调用条件；本次没有执行软件功能。':'尚未满足调用条件，请查看缺口。',functionExecuted:false,writePerformed:false};
}
