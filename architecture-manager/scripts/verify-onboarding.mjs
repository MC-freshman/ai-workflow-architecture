// Read back one target's actual onboarding evidence; never starts a business run.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readOnboardingConfig } from '../src/onboarding-config.mjs';
import { clientBinding } from '../src/onboarding-client.mjs';
import { environmentBinding } from '../src/onboarding-state.mjs';
import { onboardingGitPaths } from '../src/onboarding-governance.mjs';

const root=resolve(process.argv[2] || '.'); const id=process.argv[3];
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const statePath=join(root,id,'runtime/maintenance/manager-onboarding/state.json');
const state=read(statePath); const snapshot=readOnboardingConfig({workspaceRoot:root,platformId:id});
const binding=clientBinding(root,id); const scope=join(root,id,'runtime').toLowerCase()+'\\';
const own=path=>typeof path==='string' && resolve(path).toLowerCase().startsWith(scope);
const first=state.firstCertification;
const certified=first && ['matrix','conform'].every(name=>own(first[name+'Path']) && hash(first[name+'Path'])===first[name+'Sha256']);
const matrix=certified ? read(first.matrixPath) : null; const floor=certified ? read(first.conformPath) : null;
const installation=join(snapshot.config.scriptEnvironment,'..');
const backup=join(root,'inbox/backup',id,'manager-environments',installation.split(/[\\/]/).at(-1));
const registered=join(backup,'RESTORE.json'); const verified=join(backup,'RESTORE-VERIFIED.json');
const restoration=existsSync(verified) ? read(verified) : null;
const registration=existsSync(registered) ? read(registered) : null;
const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
const paths=onboardingGitPaths(root,id);
const checks={
  recordedComplete:state.status==='complete',
  currentBindings:['configSha256','versionsSha256','adapterSha256'].every(name=>state[name]===binding[name]) && state.environmentBindingSha256===environmentBinding(root,id),
  firstMatrix:certified && matrix.rows.length>0 && !matrix.rows.some(row=>['FAIL','NEEDS-INPUT'].includes(row.status)),
  capabilityFloor:certified && floor.floorReached===true,
  clientLoop:state.steps.some(step=>step.step==='client-tool-loop' && step.status==='passed' && own(step.evidencePath) && hash(step.evidencePath)===step.evidenceSha256 && step.result.receipt.challenge===step.result.challenge),
  restoredArchives:restoration && hash(registered)===restoration.registrationSha256 && ['hostRestored','sealedRestored','hashesMatch'].every(key=>restoration.result[key]===true) && hash(join(backup,'sealed-environment.zip'))===registration.sealedArchiveSha256 && hash(join(backup,'host-environment.zip'))===registration.hostArchiveSha256,
  configurationCommitted:!!state.git?.head && !git(['status','--porcelain','--',...paths]) && paths.every(path=>!!git(['ls-files','--error-unmatch','--',path])),
  privateBytesExcluded:!git(['ls-files','--',`${id}/runtime`,`inbox/backup/${id}`])
};
const input={checks,configuration:binding,evidence:{matrix:first?.matrixSha256,conform:first?.conformSha256,restoration:existsSync(verified)?hash(verified):null},counts:matrix?.summary};
const report={schema:'architecture-manager-onboarding-verification/v1',platformId:id,workspaceRoot:root,checkedAt:new Date().toISOString(),...input,ok:Object.values(checks).every(value=>value===true),digest:createHash('sha256').update(JSON.stringify(input)).digest('hex'),nativeVendorClientVerified:false,businessStagesExecuted:false};
writeFileSync(join(root,id,'runtime/maintenance/manager-onboarding/verification-digest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2)); if(!report.ok) process.exitCode=1;
