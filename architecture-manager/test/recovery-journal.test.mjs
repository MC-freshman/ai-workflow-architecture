import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {sha256} from '../src/core/hash.mjs';
import {prepareRecovery,completeRecovery,resumeRecovery,resumePendingRecoveries} from '../src/transactions/recovery-journal.mjs';
import {applyPlan} from '../src/transactions/router.mjs';
import {buildIntegrationPlan} from '../src/domains/platforms/integration.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'manager-journal-'));t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-journal-'));rmSync(root,{recursive:true,force:true});});
  const auditRoot=join(root,'audit'),entries=['first','second','third'].map((name,index)=>{
    const target=join(root,name);writeFileSync(target,'after '+name);
    return {target,before:index===2?null:'before '+name,afterSha256:sha256('after '+name)};
  });
  const path=prepareRecovery({auditRoot,workspaceRoot:root,transactionId:'fixture',entries});return {root,auditRoot,entries,path};
}
test('two real process exits during recovery resume from persisted hashes, then replay writes nothing',t=>{
  const f=fixture(t),module=new URL('../src/transactions/recovery-journal.mjs',import.meta.url).href;
  const code=`import {resumeRecovery} from ${JSON.stringify(module)};resumeRecovery(${JSON.stringify(f.auditRoot)},${JSON.stringify(f.path)},{onProgress:event=>{if(event.restored)process.exit(73);}});`;
  for(let n=0;n<2;n++)assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code],{windowsHide:true}).status,73);
  assert.equal(JSON.parse(readFileSync(f.path)).status,'recovering');
  assert(resumeRecovery(f.auditRoot,f.path).ok);
  assert.equal(readFileSync(f.entries[0].target,'utf8'),'before first');assert.equal(readFileSync(f.entries[1].target,'utf8'),'before second');assert(!existsSync(f.entries[2].target));
  const before=readFileSync(f.path);assert.deepEqual(resumeRecovery(f.auditRoot,f.path).restored,[]);assert(before.equals(readFileSync(f.path)));
});
test('external changes block the whole recovery; changed checkpoint bytes fail before restoration',t=>{
  const f=fixture(t);writeFileSync(f.entries[1].target,'external');
  assert.equal(resumeRecovery(f.auditRoot,f.path).ok,false);assert.equal(readFileSync(f.entries[0].target,'utf8'),'after first');assert(existsSync(f.entries[2].target));
  writeFileSync(f.entries[1].target,'after second');const journal=JSON.parse(readFileSync(f.path));writeFileSync(join(f.auditRoot,'recoveries',journal.entries[0].checkpoint),'corrupt');
  assert.throws(()=>resumeRecovery(f.auditRoot,f.path),/CHECKPOINT_CHANGED/);assert.equal(readFileSync(f.entries[0].target,'utf8'),'after first');
});
test('completed transactions never roll back on retry',t=>{
  const f=fixture(t);completeRecovery(f.auditRoot,f.path);
  assert.deepEqual(resumePendingRecoveries({auditRoot:f.auditRoot,workspaceRoot:f.root,targets:f.entries.map(entry=>entry.target)}),[]);
  assert.equal(readFileSync(f.entries[0].target,'utf8'),'after first');
});
test('integration retry automatically finishes an interrupted rollback before applying a validated plan',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'codex','bridge'),{recursive:true});
  const target=join(f.root,'codex','bridge.json');
  const old=JSON.stringify({schema:'ai-platform-bridge/v1',platform:'codex',shared:{readOnly:true,agentRegistry:'agent/registry.json',toolRegistry:'tool/registry.json',architecturePrompt:'AI_ARCHITECTURE_SYSTEM_PROMPT.md'},runtimeRoot:'codex/runtime',modes:['workflow']});
  writeFileSync(target,old);const afterText=JSON.stringify({...JSON.parse(old),label:'new'});
  const plan=buildIntegrationPlan({workspaceRoot:f.root,kind:'platform',targetId:'codex',afterText});
  const interrupted=prepareRecovery({auditRoot:f.auditRoot,workspaceRoot:f.root,transactionId:'integration-interrupt',entries:[{target,before:old,afterSha256:sha256(afterText)}]});writeFileSync(target,afterText);
  assert.equal(applyPlan({plan,auditRoot:f.auditRoot}).status,'applied');assert.equal(readFileSync(target,'utf8'),afterText);assert.equal(JSON.parse(readFileSync(interrupted)).status,'recovered');
});
