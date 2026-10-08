import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {readPlatformResourceVersions,buildPlatformResourceDefaultPlan,applyPlatformResourceDefault} from './resource-defaults.mjs';

// The native MCP service supplies its own fixed configuration path. Requests never select a platform.
async function run(){
  const [configPath]=process.argv.slice(2);if(!configPath)throw Error('PLATFORM_CONFIGURATION_REQUIRED');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
  const platformRoot=resolve(config.platformRoot),workspaceRoot=dirname(platformRoot),platformId=config.platform;
  if(resolve(platformRoot,'bridge',configPath.split(/[\\/]/).pop())!==resolve(configPath)||platformRoot!==resolve(workspaceRoot,platformId))throw Error('PLATFORM_SCOPE_MISMATCH');
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(request.platformId&&request.platformId!==platformId)throw Error('PLATFORM_SCOPE_MISMATCH');
  if(request.operation==='get')return readPlatformResourceVersions({workspaceRoot,platformId});
  if(!['preview','set'].includes(request.operation))throw Error('INVALID_MANAGEMENT_OPERATION');
  const repository=request.kind==='workflow'?'tool':request.kind==='agent'?'agent':request.repository;
  const plan=buildPlatformResourceDefaultPlan({workspaceRoot,platformId,repository,resourceId:request.resourceId,targetVersion:request.version ?? null});
  if(request.operation==='preview')return plan;
  if(request.confirm!==true)throw Error('TRANSACTION_CONFIRMATION_REQUIRED');
  return applyPlatformResourceDefault(plan,{actor:'native-ai-user-request'});
}
try{process.stdout.write(JSON.stringify({ok:true,result:await run()})+'\n');}catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1;}
