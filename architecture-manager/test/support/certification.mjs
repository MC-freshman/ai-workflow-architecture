import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {seedRelease,seedPointer,seedRuntimeReleases} from './resources.mjs';
import {certificationSnapshot} from '../../src/domains/certification/fingerprints.mjs';
import {certificationSelection} from '../../src/domains/certification/selection.mjs';
import {mergeCertification,matrixSummary} from '../../src/domains/certification/evidence.mjs';
import {sha256} from '../../src/core/hash.mjs';

export function certificationFixture(t) {
  const root=mkdtempSync(join(tmpdir(),'manager-certification-')),id='test-client';
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const put=(path,value)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
  seedRuntimeReleases(root);
  seedRelease(root,'tool','expert-task','1.0.0');seedPointer(root,'tool','expert-task','1.0.0');
  seedRelease(root,'agent','profile-task','1.0.0');seedPointer(root,'agent','profile-task','1.0.0');
  const profileManifest=JSON.parse(readFileSync(join(root,'agent/profile-task/versions/1.0.0/manifest.json')));profileManifest.requiredProfiles=['python>=3.8'];seedRelease(root,'agent','profile-task','1.0.0',{'manifest.json':profileManifest});
  seedRelease(root,'software','demo-cli','1.0.0');seedPointer(root,'software','demo-cli','1.0.0');
  for(const name of ['architecture-ops','platform-conformance']) {seedRelease(root,'tool',name,'1.0.0');seedPointer(root,'tool',name,'1.0.0');}
  const registries={tool:{workflows:[{id:'expert-task',enabled:true,current:'expert-task/current.json'}]},agent:{agents:[{id:'profile-task',enabled:true,current:'profile-task/current.json'}]},software:{software:[{id:'demo-cli',enabled:true,current:'demo-cli/current.json'}]}};
  for(const [repo,value] of Object.entries(registries)) put(repo+'/registry.json',value);
  const config={platform:id,toolRoot:join(root,'tool'),agentRoot:join(root,'agent'),softwareRoot:join(root,'software'),runner:join(root,'tool/wf-runner/versions/0.12.0'),contracts:join(root,'tool/runtime-contracts/versions/1.5.0'),scannerRelease:join(root,'tool/repo-lint/versions/0.6.3'),capabilities:join(root,id,'bridge/capabilities.json'),softwareGatewayConfig:join(root,id,'bridge/gateway.json')};
  put(id+'/bridge/runner-config.json',config);put(id+'/bridge/capabilities.json',{profiles:{'python>=3.8':'3.10'},checks:{'runner-protocol-prepare':true,'terminal-stop-with-evidence':true}});put(id+'/bridge/gateway.json',{bodies:{'demo-cli':'absent body'},launchProvider:['provider-one']});
  const snapshot=()=>certificationSnapshot(root,id,config);
  let sequence=0;
  const positive=cell=>({...cell,prepare:true,claimed:true,stopped:true,snapshotFrozen:true,bodyVerified:true,status:'PASS'});
  const publish=(selection,value=snapshot(),rows=null)=>{
    const directory=join(root,id,'runtime/manager-check/attempt-'+sequence++);mkdirSync(directory,{recursive:true});
    const actual=selection.selected.length?join(directory,'matrix.json'):null,conform=join(directory,'conform.json');
    if(actual) {const cells=rows || selection.selected.map(key=>positive(value.cells[key]));writeFileSync(actual,JSON.stringify({schema:'ai-invocation-matrix/v1',rows:cells,summary:matrixSummary(cells)}));}
    writeFileSync(conform,JSON.stringify({floorReached:true,counts:{pass:1,declaredAbsent:0,unverified:0}}));
    return {...mergeCertification(root,id,value,selection,actual,conform,directory),actual,conform,directory};
  };
  const baseline=()=>{const value=snapshot();return publish(certificationSelection(root,id,value,{mode:'full'}),value);};
  return {root,id,config,put,snapshot,publish,baseline,positive,registries,hash:path=>sha256(readFileSync(path))};
}
