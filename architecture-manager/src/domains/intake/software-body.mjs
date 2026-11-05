import fs from 'node:fs';
import {join,extname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runScopedProcess} from '../../infrastructure/process-scope.mjs';
import {sha256,sha256File} from '../../core/hash.mjs';
import {targetPath} from '../../core/paths.mjs';
import {readJson} from '../../core/json.mjs';
import {platformPython} from '../platforms/runtime-binding.mjs';
import {runnerConfig,resolveRecipeVersion} from '../software/software-publish.mjs';
import {buildRuntimeBodyPlan,verifyRuntimeBody} from './runtime-body.mjs';
import {buildIntakePublicationPlan} from './publication.mjs';
import {assertBodyIdentity,sharedRegistration,encode} from './shared-body.mjs';
import {hasSensitiveLiteral} from './policy.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';
import {mcpCredentialReferences} from '../software/mcp-config.mjs';
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const buildSoftwareBodyPlacementPlan=({intake,platformId,softwareId})=>buildRuntimeBodyPlan({intake,platformId,resourceId:softwareId});
export function normalizeSoftwareAction(action) {
  const {name,args=[],parameters=[],sideEffects='none',filesystem='read',network='none',credentialReference='none',probeReadOnly=false}=action;
  if(!NAME.test(name || '') || !Array.isArray(args) || args.some(arg=>typeof arg!=='string') || !['none','local-write','external'].includes(sideEffects) || !['none','read','workspace'].includes(filesystem) || !['none','loopback','public'].includes(network) || !/^(none|reference:[A-Za-z0-9._-]+)$/.test(credentialReference))throw Error('SOFTWARE_ACTION_INVALID');
  const properties={},required=[],mapping=[];
  for(const parameter of parameters) {
    if(!NAME.test(parameter.name || '') || Object.hasOwn(properties,parameter.name) || !['string','integer','boolean'].includes(parameter.type || 'string') || !['repeat','equals','positional'].includes(parameter.style || 'repeat') || typeof(parameter.flag || '')!=='string')throw Error('SOFTWARE_ACTION_INVALID');
    properties[parameter.name]={type:parameter.type || 'string'};if(parameter.required)required.push(parameter.name);
    mapping.push({param:parameter.name,style:parameter.style || 'repeat',flag:parameter.flag || '',required:Boolean(parameter.required)});
  }
  if(probeReadOnly && (sideEffects!=='none' || network!=='none' || credentialReference!=='none' || filesystem==='workspace'))throw Error('SOFTWARE_UNSAFE_PROBE');
  const result={name,args,parameters,sideEffects,filesystem,network,credentialReference,probeReadOnly,properties,required,mapping};if(hasSensitiveLiteral(encode(result)))throw Error('RAW_SECRET_NOT_ALLOWED');return result;
}
function argvFor(action,values) {
  const args=[...action.args];
  for(const parameter of action.parameters) {
    const value=values[parameter.name];if(value===undefined){if(parameter.required)throw Error('SOFTWARE_PROBE_ARGUMENT_REQUIRED');continue;}
    if((parameter.type==='integer' && !Number.isInteger(value)) || (parameter.type==='boolean' && typeof value!=='boolean') || ((!parameter.type || parameter.type==='string') && typeof value!=='string'))throw Error('SOFTWARE_ACTION_INVALID');
    const flag=parameter.flag || '',style=parameter.style || 'repeat';args.push(...(style==='positional'?[String(value)]:style==='equals'?[flag+'='+value]:flag?[flag,String(value)]:[String(value)]));
  }return args;
}
function readOnlyProbe(entry,runtime,action,values={}) {
  if(hasSensitiveLiteral(encode(values)))throw Error('RAW_SECRET_NOT_ALLOWED');
  const argv=argvFor(action,values),stdout=runScopedProcess(runtime || entry,[...(runtime?[entry]:[]),...argv],{cwd:join(entry,'..'),encoding:'utf8',timeout:15000,maxBuffer:1024*1024,windowsHide:true,shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});
  return {argumentsSha256:sha256(encode(argv)),stdoutSha256:sha256(stdout),output:String(stdout).trim().slice(0,2000),observed:true};
}
export function buildSoftwareBodyPlan({placementPlan,displayName,upstreamVersion='unknown',license='unknown',releaseVersion=null,mode='cli',runtimeExecutable='',versionArgs=['--version'],actions=[],launchArgs=[],adopt=true,now=new Date().toISOString()}) {
  const placement=verifyRuntimeBody({plan:placementPlan});if(!placement.ok)throw Error('SOFTWARE_BACKUP_NOT_RESTORED');
  const intake=placementPlan.payload.intake,platformId=placementPlan.target.platformId,softwareId=placementPlan.target.resourceId,root=placementPlan.workspaceRoot,entry=placement.entry,selected=intake.files.find(row=>row.path===intake.selectedEntry);
  if(intake.type!=='software' || !selected?.runnable || selected.installer)throw Error('INSTALLER_NOT_INSTALLED');
  const version=resolveRecipeVersion(root,softwareId,releaseVersion);assertBodyIdentity(softwareId,version);if(!['cli','gui'].includes(mode) || !String(displayName || '').trim() || !String(upstreamVersion).trim() || !Array.isArray(launchArgs) || launchArgs.some(arg=>typeof arg!=='string'))throw Error('INVALID_SOFTWARE_RECIPE_INPUT');
  const connector=runnerConfig(root,platformId),python=platformPython(root,platformId).python,extension=extname(entry).toLowerCase();
  const runtime=runtimeExecutable || (extension==='.py'?python:null);if(runtime && !fs.existsSync(runtime))throw Error('RUNTIME_PYTHON_REQUIRED');
  if(mode==='gui' && extension!=='.exe')throw Error('SOFTWARE_GUI_EXECUTABLE_REQUIRED');if(mode==='cli' && extension!=='.exe' && !runtime)throw Error('SOFTWARE_RUNTIME_REQUIRED');
  const declarations=mode==='gui'?[normalizeSoftwareAction({name:'session',sideEffects:'local-write',filesystem:'workspace'})]:[normalizeSoftwareAction({name:'version',args:versionArgs,probeReadOnly:true}),...actions.map(normalizeSoftwareAction)];
  if(new Set(declarations.map(row=>row.name)).size!==declarations.length)throw Error('SOFTWARE_ACTION_INVALID');
  const files={},observed={},capabilities=[],snapshotCapabilities=[],runtimeKey='managerRuntime_'+softwareId.replaceAll('-','_'),alias=softwareId+'-runtime';
  for(const action of declarations) {
    const inputSchemaRef=`schemas/${action.name}.input.json`,outputSchemaRef=`schemas/${action.name}.output.json`,permissionRequests={filesystem:action.filesystem,network:action.network,process:'self',credentials:action.credentialReference},capability={name:action.name,nativeName:action.name,inputSchemaRef,outputSchemaRef,sideEffects:action.sideEffects,permissionRequests,consent:action.sideEffects==='none'?'auto':'confirm-call',idempotent:action.sideEffects==='none',safeForSelftest:action.probeReadOnly,invocation:mode==='gui'?{kind:'desktop-session',target:'${bodyPath}',versionField:'entrySha256'}:{executable:runtime?'${'+runtimeKey+'}':'${bodyPath}',baseArgv:[...(runtime?['${bodyPath}']:[]),...action.args],argMapping:action.mapping,outputCapture:'stdout',outputFormat:'text',timeout:30,successExitCodes:[0]}};
    files[inputSchemaRef]=encode({$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:action.properties,required:action.required,additionalProperties:false});files[outputSchemaRef]=encode({type:'object',properties:{rawOutput:{type:'string'}}});
    if(mode==='cli' && action.probeReadOnly) {
      observed[action.name]=readOnlyProbe(entry,runtime,action,actions.find(row=>row.name===action.name)?.testArguments || {});
      if(action.name==='version' && (upstreamVersion==='unknown' || !observed.version.output.includes(upstreamVersion)))throw Error('SOFTWARE_VERSION_UNVERIFIED');
    }
    capabilities.push(capability);snapshotCapabilities.push({name:action.name,nativeName:action.name,inputSchemaRef,outputSchemaRef,sideEffects:action.sideEffects,consent:capability.consent,idempotent:capability.idempotent,safeForSelftest:capability.safeForSelftest,frozen:Boolean(observed[action.name]),observation:observed[action.name] || {pending:true,reason:mode==='gui'?'Session start/status/close are separately verified; native GUI functions are not declared.':'Declared action not yet executed in a confirmed read-only probe.'}});
  }
  if(sha256File(entry)!==selected.sha256)throw Error('SOFTWARE_BODY_CHANGED');
  const manifest={schema:'ai-software/v1',id:softwareId,version,displayName:displayName.trim(),upstreamVersion,kind:mode==='gui'?'local-process':'cli-wrapper',transport:{command:'${bodyPath}',argsStyle:'declarative-argv'},capabilities,concurrency:{instanceMode:mode==='gui'?'singleton':'per-run',poolSize:null,exclusiveResources:mode==='gui'?['software-session:'+softwareId]:[],whenBusy:'reject-retryable'},platformSupport:{windows:'supported',linux:'untested',macos:'untested'},requiredProfiles:[],snapshot:'capabilities.snapshot.json',integrity:{sha256Manifest:'SHA256SUMS'},docs:'README.md'};
  const declaration={schema:'ai-software-connector/v1',softwareId,softwareVersion:version,adapter:mode==='gui'?'desktop-session':'generic-cli',transports:[manifest.kind],connectorRuntime:'python-3.9',interpreterAlias:runtime?alias:null,userModes:['direct-cli','mediated-call'],sessionModel:manifest.concurrency.instanceMode,requiresConsent:mode==='gui',attestation:'snapshot-only',operations:Object.fromEntries(capabilities.map(cap=>[cap.name,{capability:cap.name,inputSchemaRef:cap.inputSchemaRef,outputSchemaRef:cap.outputSchemaRef,credentials:[cap.permissionRequests.credentials],interactive:mode==='gui'}]))};
  const snapshot={schema:'ai-software-capability-snapshot/v1',softwareId,softwareVersion:version,upstreamVersion,generatedAt:now,generationMethod:mode==='gui'?'Installed body SHA verified; session and native functions have separate status.':'Live, explicitly selected read-only probes; unprobed actions remain pending.',runtime:runtime?{interpreter:alias}:{},capabilities:snapshotCapabilities,frozen:mode==='cli'};
  Object.assign(files,{'manifest.json':encode(manifest),'connector.json':encode(declaration),'capabilities.snapshot.json':encode(snapshot),'recipes/windows.json':encode({schema:'ai-software-recipe/v1',platform:'windows',softwareId,softwareVersion:version,acquire:{kind:'local-install',license,version:upstreamVersion,redistributable:false},install:{location:'${platformRuntime}/software/'+softwareId,detectedPath:null},launch:{kind:manifest.kind,entrypoint:intake.selectedEntry},verify:{files:placementPlan.rows.map(({path,sha256})=>({path,sha256})),versionCall:mode==='cli'?['${bodyPath}',...versionArgs]:null}}),'README.md':`# ${displayName}\n\nProgram bytes belong to the platform runtime. Generic CLI needs no separate MCP. Version inquiry, specific action probes and desktop session liveness are distinct evidence. GUI functions are not automated by a start/status/close session. Installation packages must first be installed and the resulting body selected. Unobserved actions remain pending.\n`});
  const provider=`${platformId}/bridge/manager-providers/platform_provider.py`,providerRoot=targetPath(root,`${platformId}/runtime/software/provider-state`),command=operation=>[python,'-B',targetPath(root,provider),operation,providerRoot],profile='manager-'+softwareId;
  const gateway={...connector.value,bodies:{...connector.value.bodies,[softwareId]:entry},interpreterAliases:{...connector.value.interpreterAliases,...(runtime?{[alias]:runtime}:{})},recipeVariables:{...connector.value.recipeVariables,...(runtime?{[runtimeKey]:runtime}:{})},sessionLaunch:command('launch'),sessionLiveness:command('liveness'),sessionTerminate:command('terminate'),sessionLaunchArguments:{...connector.value.sessionLaunchArguments,[softwareId]:launchArgs},softwareProfiles:{...connector.value.softwareProfiles,[profile]:{filesystem:[...new Set(['none',...declarations.map(row=>row.filesystem)])],network:[...new Set(['none',...declarations.map(row=>row.network)])],credentials:[...new Set(['none',...declarations.map(row=>row.credentialReference)])],consentPolicy:'per-call-user-confirmation'}}};
  const registration=sharedRegistration(root,'software',softwareId,version,displayName);if(!adopt && fs.existsSync(targetPath(root,`software/${softwareId}/current.json`)))registration.splice(0,registration.length);
  const changes=[...registration,...(adopt?[{path:relative(root,connector.path).replaceAll('\\','/'),content:encode(gateway)},{path:provider,content:fs.readFileSync(fileURLToPath(new URL('../../runtime/platform_provider.py',import.meta.url)),'utf8')}]:[])];
  return buildIntakePublicationPlan({intake,platformId,repository:'software',resourceId:softwareId,version,files,changes,placementPlan,settings:{mode,profile,observed,bodyPath:entry,upstreamVersion,launchArgs,adopt},now});
}
export function readSoftwareBodyActions({workspaceRoot,softwareId,platformId=null}) {
  if(!/^[a-z0-9][a-z0-9._-]*$/.test(softwareId || ''))throw Error('INVALID_SOFTWARE_ID');
  const current=readJson(targetPath(workspaceRoot,`software/${softwareId}/current.json`)),{directory,manifest}=validateFrozenResource(workspaceRoot,'software',softwareId,current.version),snapshot=readJson(join(directory,manifest.snapshot));
  let requiredReferences=[];if(platformId){try{requiredReferences=mcpCredentialReferences(runnerConfig(workspaceRoot,platformId).value.nativeMcpServers?.[softwareId] || {});}catch{/* Binding unavailable is shown by the command planner. */}}
  return {softwareId,version:current.version,kind:manifest.kind,requiredReferences,actions:manifest.capabilities.map(cap=>({...cap,inputSchema:readJson(join(directory,cap.inputSchemaRef)),observed:snapshot.capabilities?.find(row=>row.name===cap.name)?.frozen!==false && snapshot.frozen===true,definitionOnly:snapshot.capabilities?.find(row=>row.name===cap.name)?.observation?.functionExecuted===false})),writePerformed:false};
}
