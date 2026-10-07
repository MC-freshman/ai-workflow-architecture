import fs from 'node:fs';
import {relative,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from '../../core/hash.mjs';
import {targetPath} from '../../core/paths.mjs';
import {providerTemplateStatus} from './provider-templates.mjs';
import {clientBinding} from '../../onboarding-client.mjs';
import {environmentBinding} from '../certification/binding.mjs';

export function onboardingReadback(root,id,state) {
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,shell:false,maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
  const prefix=id+'/runtime/',first=state.firstCertification,templates=providerTemplateStatus(root,id),binding=clientBinding(root,id);
  const proofs=['matrix','conform'].map(name=>{
    const path=first?.[name+'Path'],own=path && relative(targetPath(root,id+'/runtime'),resolve(path));
    return {name,ok:Boolean(own && !own.startsWith('..') && fs.existsSync(path) && sha256(fs.readFileSync(path))===first[name+'Sha256'])};
  });
  let privacy={available:false,legacyTrackedCount:null,currentCommitPrivateBytesExcluded:false};
  try {
    const tracked=git(['ls-files','-z','--',prefix]);
    const changed=state.git?.head?git(['diff-tree','--root','--no-commit-id','--name-only','-r','-z',state.git.head]):[];
    const currentPrivate=changed.filter(path=>path.startsWith(prefix));
    const legacyKinds={runtimeText:0,binaryOrOther:0};for(const path of tracked)legacyKinds[/\.(jsonl?|md|txt|log|py|ps1|mjs|ya?ml|csv|sha256|gitkeep)$/i.test(path)?'runtimeText':'binaryOrOther']++;
    privacy={available:true,legacyTrackedCount:tracked.length,legacyTrackedPaths:tracked,legacyKinds,currentCommitPrivateBytesExcluded:Boolean(state.git?.head) && !currentPrivate.length,currentCommitPrivatePaths:currentPrivate,repositoryPrivacyCompliant:!tracked.length,rule:'BP-6 §6.3: runtime running artifacts do not belong in Git; historical drift requires a separate cleanup plan'};
  }catch{/* No Git or unreadable historical commit cannot pass privacy readback. */}
  const currentBindings=['configSha256','versionsSha256','adapterSha256'].every(key=>state[key]===binding[key]) && state.environmentBindingSha256===environmentBinding(root,id);
  const onboardingVerified=state.status==='complete' && currentBindings && templates.current && proofs.every(row=>row.ok);
  const report={schema:'architecture-manager-onboarding-readback/v2',platformId:id,recordedStatus:state.status,onboardingVerified,currentBindings,providerTemplates:templates,proofs,privacy,proofScope:'callable-protocol-and-first-certification',businessStagesExecuted:false,nativeVendorClientVerified:false,writePerformed:false};
  report.digest=sha256(JSON.stringify(report));return report;
}
