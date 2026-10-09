import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {healthSoftware} from '../src/software.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'manager-health-'));
  t.after(()=>{assert.ok(relative(tmpdir(),root).startsWith('manager-health-'));rmSync(root,{recursive:true,force:true});});
  const put=(name,data)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),typeof data==='string'?data:JSON.stringify(data));};
  seedRelease(root,'software','demo','1.0.0',{'recipes/windows.json':{install:{detectedPath:null},verify:{versionCall:['${softwareRoot}/fixture.exe','--version']}}});seedPointer(root,'software','demo','1.0.0');
  put('tool/registry.json',{workflows:[]});
  const body=join(root,'review-client/runtime/software/demo/fixture.exe');put('review-client/runtime/software/demo/fixture.exe','fake executable bytes; never executed');
  const gateway=join(root,'software/_connector/versions/1.0.7/connector.py');put('software/_connector/versions/1.0.7/connector.py','# never executed');
  const config=join(root,'review-client/bridge/software.json');put('review-client/bridge/software.json',{bodies:{demo:body}});
  put('review-client/bridge/runner-config.json',{platform:'review-client',interpreters:{'.py':process.execPath},softwareGateway:gateway,softwareGatewayConfig:config});
  put('review-client/bridge.json',{platform:'review-client',shared:{readOnly:true},modes:['workflow']});
  return {root,body,config};
}
test('health uses the explicitly selected platform binding and its connector, not recipe detectedPath',async t=>{
  const f=fixture(t);let request;
  const result=await healthSoftware(f.root,'demo','review-client',{relay:async spec=>{
    request=JSON.parse(spec.input);assert.equal(spec.args.at(-1),f.config);assert.equal(spec.python,process.execPath);
    return {exitCode:0,stdout:JSON.stringify({ok:true,result:{software:[{softwareId:'demo',dispatchable:true,bodyDigest:'match',snapshotFrozen:true}]}})};
  }});
  assert.equal(request.operation,'software.health');assert.equal(result.bodyPath,f.body);assert.equal(result.platformId,'review-client');assert.equal(result.status,'READY');assert.equal(result.functionExecuted,false);
});
test('missing selection and connector refusals cannot be shown as a passed live function',async t=>{
  const f=fixture(t);await assert.rejects(healthSoftware(f.root,'demo',null),/PLATFORM_CONFIGURATION_REQUIRED/);
  const result=await healthSoftware(f.root,'demo','review-client',{relay:async()=>({exitCode:0,stdout:JSON.stringify({ok:true,result:{software:[{softwareId:'demo',dispatchable:false,blocking:[{code:'SOFTWARE_DRIFT'}]}]}})})});
  assert.equal(result.status,'SOFTWARE_DRIFT');assert.equal(result.dispatchable,false);assert.equal(result.functionExecuted,false);
});
