import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {seedRelease,seedPointer} from './resources.mjs';
import {encode} from '../../src/domains/intake/shared-body.mjs';
export function intakeFixture(t) {
  const base=mkdtempSync(join(tmpdir(),'manager-body-')),root=join(base,'workspace'),platformId='local-client';t.after(()=>rmSync(base,{recursive:true,force:true}));
  for(const repository of ['agent','tool','software',platformId])mkdirSync(join(root,repository),{recursive:true});
  writeFileSync(join(root,platformId,'bridge.json'),encode({schema:'ai-platform-bridge/v1',platform:platformId,shared:{readOnly:true}}));
  seedRelease(root,'tool','fixture-workflow','1.0.0');seedPointer(root,'tool','fixture-workflow','1.0.0');
  writeFileSync(join(root,'tool/registry.json'),encode({schema:'ai-tool-registry/v2',version:1,workflows:[{id:'fixture-workflow',enabled:true,current:'fixture-workflow/current.json'}],skills:[],packs:[]}));
  writeFileSync(join(root,'agent/registry.json'),encode({schema:'ai-agent-registry/v2',version:1,agents:[]}));writeFileSync(join(root,'software/registry.json'),encode({schema:'ai-software-registry/v1',version:1,software:[]}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git('init');git('config','user.name','Body Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','--','.');git('commit','-m','rollback baseline');
  return {base,root,platformId,git,auditRoot:join(base,'audit')};
}
