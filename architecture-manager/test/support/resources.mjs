import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {sha256} from '../../src/core/hash.mjs';

export function seedRelease(root,repository,id,version,extra={}) {
  const directory=join(root,repository,id,'versions',version);
  const permissions={filesystem:'project-scoped',network:'deny',process:'deny'};
  const files=repository==='tool'?{
    'manifest.json':{schema:'ai-workflow/v2.1',id,version,mode:'pipeline',entry:'workflow.yaml',inputSchema:'schemas/input.json',outputSchema:'schemas/output.json',permissions,dependencies:{workflows:{},skills:{},packs:{}},integrity:{sha256Manifest:'SHA256SUMS'}},
    'workflow.yaml':{schema:'ai-workflow-definition/v2',id,version,mode:'pipeline',maxParallel:1,stages:[{id:'INTAKE',action:'prompt',worker:'expert',promptRef:'prompt.md#stage:INTAKE',dependsOn:[]}]},
    'prompt.md':'# Task\n<!-- stage:INTAKE -->\nDescribe the provided request.\n<!-- /stage:INTAKE -->\n',
    'schemas/input.json':{type:'object',properties:{request:{type:'string'}},additionalProperties:false},
    'schemas/output.json':{type:'object',properties:{answer:{type:'string'}},additionalProperties:false}
  }:repository==='agent'?{
    'manifest.json':{schema:'ai-agent/v2',id,version,role:'test',prompt:'prompt.md',toolLock:'tool-lock.json',workflows:[],permissions,integrity:{sha256Manifest:'SHA256SUMS'}},
    'prompt.md':'# Agent\nUse the provided request.\n',
    'tool-lock.json':{schema:'ai-tool-lock/v2',workflows:{},skills:{},packs:{},profiles:{}}
  }:{
    'manifest.json':{schema:'ai-software/v1',id,version,displayName:'Fixture',upstreamVersion:'1.0',kind:'cli-wrapper',transport:{command:'${softwareRoot}/fixture.exe'},capabilities:[{name:'version',nativeName:'--version',inputSchemaRef:'schemas/input.json',outputSchemaRef:'schemas/output.json',sideEffects:'none',permissionRequests:{filesystem:'read',network:'none',process:'self',credentials:'none'},consent:'auto',idempotent:true,safeForSelftest:true,invocation:{executable:'fixture.exe',baseArgv:['--version'],argMapping:[],outputCapture:'stdout',outputFormat:'text',timeout:15,successExitCodes:[0]}}],concurrency:{instanceMode:'per-run',poolSize:null,exclusiveResources:[],whenBusy:'reject-retryable'},platformSupport:{windows:'supported',linux:'untested',macos:'untested'},requiredProfiles:[],snapshot:'capabilities.snapshot.json',integrity:{sha256Manifest:'SHA256SUMS'},docs:'README.md'},
    'capabilities.snapshot.json':{schema:'ai-software-capability-snapshot/v1',frozen:false},
    'schemas/input.json':{type:'object',additionalProperties:false},
    'schemas/output.json':{type:'object',properties:{output:{type:'string'}}},
    'README.md':'# Fixture\nNo body is executed.\n'
  };
  Object.assign(files,extra);
  const entries=[];
  for(const [name,value] of Object.entries(files)) {
    const content=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n';
    mkdirSync(dirname(join(directory,name)),{recursive:true});writeFileSync(join(directory,name),content);entries.push(`${sha256(content)}  ${name}`);
  }
  writeFileSync(join(directory,'SHA256SUMS'),entries.sort().join('\n')+'\n');
  return directory;
}
export function seedPointer(root,repository,id,version) {
  const kind=repository==='tool'?'workflow':repository==='agent'?'agent':'software';
  mkdirSync(join(root,repository,id),{recursive:true});
  writeFileSync(join(root,repository,id,'current.json'),JSON.stringify({schema:`ai-${kind}-pointer/v1`,id,version,hashManifest:'SHA256SUMS'},null,2)+'\n');
}

export function seedRuntimeReleases(root) {
  for(const [repository,id,version,entry] of [['tool','wf-runner','0.12.0','cli.py'],['tool','runtime-contracts','1.5.0','contracts/runtime/validate_contracts.py'],['tool','repo-lint','0.6.3','scripts/repo_lint.py'],['software','_connector','1.0.7','connector.py']]) {
    const extra={[entry]:'# configuration fixture; never an invocable runner\n'};
    if(id==='runtime-contracts') extra['manifest.json']={schema:'ai-contract-package/v1',id,version,entry};
    if(id==='_connector') extra['manifest.json']={schema:'ai-software-connector-component/v1',id,version,displayName:'Test connector',kind:'local-process',invocable:false,runtime:{type:'python-cli',entry,python:'>=3.9'},contract:{},integrity:{sha256Manifest:'SHA256SUMS'}};
    seedPointer(root,repository,id,version);seedRelease(root,repository,id,version,extra);
  }
}
