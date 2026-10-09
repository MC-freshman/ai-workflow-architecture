import {assertBodyIdentity,readBodyEditor,listBodyDependencies,buildAgentSkillBodyPlan} from './domains/intake/shared-body.mjs';
import {readToolBodyEditor,buildToolBodyPlan} from './domains/intake/tool-body.mjs';
import {draftTextSource} from './domains/intake/sources.mjs';
import {parseDefinition} from './domains/resources/contracts.mjs';
import {verifyIntakePublication} from './domains/intake/publication.mjs';
import {parseJson as parseJsonText} from './core/json.mjs';
import {removeOwnedDirectory} from './transactions/recovery.mjs';
import { validateResourceContent } from './domains/resources/contracts.mjs';
import { validateFrozenResource } from './domains/resources/versions.mjs';
import { verifyFrozenDirectory } from './domains/resources/integrity.mjs';
// Release wizard (3.5.0 P4): publish/upgrade scaffolds for the tool and agent
// shared repositories. Publishing creates a NEW semver directory and never
// touches published bytes; adoption stays a separate resource-pointer plan
// (发布 ≠ 采纳). Every file is covered by a regenerated SHA256SUMS and
// re-verified after write.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from './core/hash.mjs';
import { targetPath,safeRelative } from './core/paths.mjs';
import { atomicWrite, makeId, output, requirePlan, writeAudit } from './transactions/kernel.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORIES = { tool: { key: 'workflows' }, agent: { key: 'agents' } };
function listFilesRecursive(directory,prefix='') {
  const out=[];
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    if(['__pycache__','.pytest_cache','node_modules','SHA256SUMS'].includes(entry.name))continue;
    const path=prefix+entry.name;
    if(entry.isDirectory())out.push(...listFilesRecursive(join(directory,entry.name),path+'/'));else out.push(path);
  }
  return out.sort();
}

export async function buildReleasePlan({workspaceRoot,platformId,repository,resourceId,targetVersion,upgradeFrom=null,definitionOverride=null,content=null,runnerWorkflow=null,adopt=false,displayName=null}) {
  if(!['tool','agent'].includes(repository))throw Error('RELEASE_REPOSITORY_INVALID');
  assertBodyIdentity(resourceId,targetVersion);
  if(existsSync(targetPath(workspaceRoot,repository+'/'+resourceId+'/versions/'+targetVersion)))throw Error('RELEASE_VERSION_EXISTS');
  if(upgradeFrom && !existsSync(targetPath(workspaceRoot,repository+'/'+resourceId+'/versions/'+upgradeFrom)))throw Error('RELEASE_UPGRADE_SOURCE_MISSING');
  if(repository==='tool') {
    const editor=upgradeFrom?await readToolBodyEditor({workspaceRoot,platformId,resourceId,version:upgradeFrom}):null;
    return buildToolBodyPlan({workspaceRoot,platformId,intake:editor?.intake,resourceId,version:targetVersion,displayName,content:content ?? undefined,manifest:editor?.manifest,definition:definitionOverride?parseDefinition(definitionOverride):editor?.definition,dependencies:editor?.fields.dependencies || {workflows:{},skills:{},packs:{}},adopt});
  }
  const editor=upgradeFrom?await readBodyEditor({workspaceRoot,platformId,type:'agent',resourceId,version:upgradeFrom}):null;
  const chosen=runnerWorkflow || editor?.fields.runnerWorkflow || listBodyDependencies({workspaceRoot}).workflows[0]?.id;
  const dependencies=editor?.fields.dependencies || {workflows:Object.fromEntries(listBodyDependencies({workspaceRoot}).workflows.filter(row=>row.id===chosen).map(row=>[row.id,row.version]))};
  const body=definitionOverride || content || editor?.content || '按用户提供的任务和项目材料处理请求，遵守精确工作流锁与项目边界，缺少输入时明确说明。';
  return buildAgentSkillBodyPlan({intake:editor?.intake || draftTextSource({workspaceRoot,platformId,type:'agent',files:{'expert.md':body},entryPath:'expert.md'}),platformId,resourceId,version:targetVersion,displayName,content:body,runnerWorkflow:chosen,dependencies,existingManifest:editor?.fields.manifest});
}

export function applyRelease(plan, context) {
  requirePlan(plan);
  const root = resolve(plan.workspaceRoot);
  const { repository, resourceId, targetVersion, destination } = plan.target;
  if(destination!==`${repository}/${resourceId}/versions/${targetVersion}`) throw new Error('INVALID_TRANSACTION_TARGET');
  const candidate=new Map(plan.payload.files.map(file=>[file.path,file.content]));
  validateResourceContent({repository,resourceId,version:targetVersion,read:name=>candidate.get(name),has:name=>candidate.has(name)});
  const versionRoot = targetPath(root, destination);
  const sumsPath = join(versionRoot, 'SHA256SUMS');
  const id = makeId(plan, context.now);
  if (existsSync(sumsPath)) {
    const actualSums = readFileSync(sumsPath, 'utf8');
    if (actualSums === plan.payload.sums) {
      validateFrozenResource(root,repository,resourceId,targetVersion);
      return output(writeAudit({ ...context, transactionId: id, plan, action: 'release-publish', status: 'already-applied', target: destination, newSha256: plan.steps[0].sumsSha256 }));
    }
    throw new Error('RELEASE_VERSION_EXISTS');
  }
  if (existsSync(versionRoot)) throw new Error('RELEASE_VERSION_EXISTS');
  for(const file of [...plan.payload.files,...(plan.payload.copyFrom?.files || [])]) {
    if(safeRelative(file.path)!==file.path.replaceAll('\\','/')) throw new Error('INVALID_TRANSACTION_TARGET');
    targetPath(root,`${destination}/${file.path}`);
  }
  let created = false;
  try {
    for (const file of plan.payload.files) {
      const target = targetPath(root,`${destination}/${file.path}`);
      mkdirSync(join(target, '..'), { recursive: true });
      atomicWrite(target, file.content, id);
      created = true;
    }
    if (plan.payload.copyFrom) {
      const sourceRoot = join(root, repository, resourceId, 'versions', plan.payload.copyFrom.version);
      if (!existsSync(sourceRoot)) throw new Error('RELEASE_UPGRADE_SOURCE_MISSING');
      for (const binary of plan.payload.copyFrom.files) {
        const target = targetPath(root,`${destination}/${binary.path}`);
        mkdirSync(join(target, '..'), { recursive: true });
        copyFileSync(join(sourceRoot, binary.path), target);
        created = true;
      }
    }
    mkdirSync(versionRoot, { recursive: true });
    atomicWrite(sumsPath, plan.payload.sums, id);
    created = true;
    validateFrozenResource(root,repository,resourceId,targetVersion);
    const event = writeAudit({ ...context, transactionId: id, plan, action: 'release-publish', status: 'applied', target: destination, newSha256: plan.steps[0].sumsSha256, writePerformed: true });
    return output(event);
  } catch (error) {
    if (created && existsSync(versionRoot)) {
      const expected=new Map([...plan.payload.files.map(file=>[file.path,sha256(file.content)]),...(plan.payload.copyFrom?.files || []).map(file=>[file.path,file.sha256]),['SHA256SUMS',sha256(plan.payload.sums)]]);
      if(!removeOwnedDirectory(versionRoot,expected).ok) throw Object.assign(new Error('RECOVERY_EXTERNAL_CHANGE'),{originalError:error.message});
    }
    throw Object.assign(new Error(String(error?.message ?? error)), {});
  }
}

function verifyReleaseDir(versionRoot) { return verifyFrozenDirectory(versionRoot); }


export function verifyRelease({ plan }) {
  if(plan.kind==='body-import')return verifyIntakePublication({plan});
  const root = resolve(plan.workspaceRoot);
  const versionRoot = join(root, plan.target.destination);
  if (!existsSync(versionRoot)) {
    return { schema: 'architecture-manager-verification/v1', ok: false, target: plan.target.destination, error: 'RELEASE_DIR_MISSING', writePerformed: false };
  }
  try {
    verifyReleaseDir(versionRoot);
    validateFrozenResource(root,plan.target.repository,plan.target.resourceId,plan.target.targetVersion);
    return { schema: 'architecture-manager-verification/v1', ok: true, target: plan.target.destination, writePerformed: false };
  } catch (error) {
    return { schema: 'architecture-manager-verification/v1', ok: false, target: plan.target.destination, error: String(error?.message ?? error), writePerformed: false };
  }
}

export function readRegistryBaseline(workspaceRoot, kind) {
  const paths = { agent: 'agent/registry.json', skill: 'tool/registry.json', workflow: 'tool/registry.json' };
  const relativePath = paths[kind];
  if (!relativePath) throw new Error('INVALID_CATALOG_KIND');
  const registryPath = targetPath(resolve(workspaceRoot), relativePath);
  if (!existsSync(registryPath)) throw new Error('CATALOG_REGISTRY_NOT_FOUND');
  const content = readFileSync(registryPath, 'utf8');
  return { path: relativePath, sha256: sha256(content) };
}

export function listResourceReferences(workspaceRoot, repository, resourceId) {
  const root = resolve(workspaceRoot);
  const scanRoots = [join(root, 'tool'), join(root, 'agent')];
  const needle = String(resourceId || '');
  if (!needle) return { references: [], scanned: 0 };
  const references = [];
  let scanned = 0;
  for (const base of scanRoots) {
    if (!existsSync(base)) continue;
    for (const resource of readdirSync(base, { withFileTypes: true })) {
      if (!resource.isDirectory()) continue;
      const currentPath = join(base, resource.name, 'current.json');
      if (!existsSync(currentPath)) continue;
      let version = null;
      try {
        version = parseJsonText(readFileSync(currentPath, 'utf8')).version;
      } catch {
        continue;
      }
      const versionRoot = join(base, resource.name, 'versions', String(version));
      if (!existsSync(versionRoot)) continue;
      for (const relativePath of listFilesRecursive(versionRoot)) {
        if (!/\.(json|yaml|yml|md|txt)$/.test(relativePath)) continue;
        const absolutePath = join(versionRoot, relativePath);
        if (!statSync(absolutePath).isFile()) continue;
        const buffer = readFileSync(absolutePath);
        if (buffer.includes(0)) continue;
        scanned += 1;
        const text = buffer.toString('utf8');
        if (text.includes(needle)) references.push({ path: `${repository === 'tool' ? 'agent' : 'tool'}/${resource.name}/versions/${version}/${relativePath}`, hint: 'mentions ' + needle });
        if (references.length >= 50) return { references, scanned, truncated: true };
      }
    }
  }
  return { references, scanned, truncated: false };
}
