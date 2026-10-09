import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {delimiter,join} from 'node:path';
import {readOnboardingConfig} from '../../onboarding-config.mjs';
import {detectRuntime} from '../../onboarding-runtime.mjs';
const run=promisify(execFile);

export function pythonCandidates(snapshot,fields={},env=process.env) {
  const values=[fields.pythonExecutable,snapshot.fields.pythonExecutable,...Object.values(snapshot.registeredInterpreterAliases || {})];
  for(const directory of (env.PATH || env.Path || '').split(delimiter).filter(Boolean)) for(const name of process.platform==='win32'?['python.exe','python3.exe']:['python3','python'])values.push(join(directory,name));
  return [...new Set(values.filter(value=>typeof value==='string' && value && existsSync(value)))];
}

export async function discoverOnboardingRuntime({workspaceRoot,platformId,fields={},backendFields={}}, {probe=detectRuntime,guestRun=run}={}) {
  const snapshot=readOnboardingConfig({workspaceRoot,platformId});
  const attempts=[];
  let selected=null;
  for(const path of pythonCandidates(snapshot,fields)) {
    const result=await probe({pythonExecutable:path,wslExecutable:backendFields.wslExecutable || snapshot.backendFields?.wslExecutable});
    const version=result.python?.version;
    attempts.push({path,version:version || null,compatible:Boolean(version && (version[0]>3 || version[0]===3 && version[1]>=10))});
    if(attempts.at(-1).compatible){selected=result;break;}
  }
  selected ||= await probe({wslExecutable:backendFields.wslExecutable || snapshot.backendFields?.wslExecutable});
  const candidates=[...new Set([backendFields.distro,snapshot.backendFields?.distro,...selected.distributions || []].filter(Boolean))];
  let backend=null;
  const guestAttempts=[];
  if(selected.wslExecutable)for(const distro of candidates){
    const interpreter=backendFields.guestInterpreter || snapshot.backendFields?.guestInterpreter || '/usr/bin/python3';
    if(!/^\/[A-Za-z0-9_./-]+$/.test(interpreter))throw Error('RUNTIME_BACKEND_REQUIRED');
    try {
      const response=await guestRun(selected.wslExecutable,['-d',distro,'--',interpreter,'-c','import json,sys;print(json.dumps(list(sys.version_info[:3])))'],{encoding:'utf8',windowsHide:true,shell:false,timeout:15000,maxBuffer:65536});
      const version=JSON.parse(response.stdout.trim());
      const compatible=version[0]===3 && version[1]===10;
      guestAttempts.push({distro,version,compatible});
      if(compatible){backend={wslExecutable:selected.wslExecutable,distro,guestInterpreter:interpreter};break;}
    } catch {guestAttempts.push({distro,compatible:false,reason:'无法运行隔离解释器'});}
  }
  return {schema:'architecture-manager-runtime-discovery/v1',platformId,pythonExecutable:attempts.find(value=>value.compatible)?.path || null,backendFields:backend,attempts,guestAttempts,issues:[...(!attempts.some(value=>value.compatible)?['需要安装 Python 3.10 或更新版本；现有解释器未达环境准备要求。']:[]),...(!backend?['需要已安装且能运行 Python 3.10 的 WSL 隔离环境；没有借用其他平台环境。']:[])],writePerformed:false};
}
