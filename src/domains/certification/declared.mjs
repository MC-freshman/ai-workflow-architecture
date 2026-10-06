// Which version of a resource this platform actually uses.
//
// The engine resolves a request in a fixed order: an explicit version wins, then the platform default
// in bridge.json, then the shared current pointer. The certification matrix used the shared pointer
// unconditionally, so a platform that declares its own default (which is how every adoption wave is
// recorded) was judged against a version it does not run — and the engine refused the pair with
// VERSION_CONFLICT, which read as a capability failure. This module states the same precedence the
// engine uses, so the judge and the engine agree by construction.
import {existsSync} from 'node:fs';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';

// A declaration may be a bare version ("0.6.5") or a release path ("E:\\ai\\tool\\repo-lint\\versions\\0.6.5").
export function declaredVersion(value) {
  if(typeof value!=='string') return null;
  const trimmed=value.trim();
  if(!trimmed) return null;
  const tail=trimmed.replaceAll('\\','/').split('/').filter(Boolean).pop();
  return /^\d+\.\d+\.\d+$/.test(tail)?tail:null;
}

export function declaredDefaults({workspaceRoot,platformId}) {
  const path=targetPath(workspaceRoot,`${platformId}/bridge.json`);
  if(!existsSync(path)) return {workflow:{},agent:{}};
  let bridge={};
  try { bridge=readJson(path); } catch { return {workflow:{},agent:{}}; }
  const defaults=bridge.defaults || {};
  const normalise=(table)=>Object.fromEntries(Object.entries(table || {}).map(([id,value])=>[id,declaredVersion(value)]).filter(([,version])=>version));
  return {workflow:normalise(defaults.workflowVersions),agent:normalise(defaults.agentVersions)};
}

// The matrix takes overrides as "kind:id@version", the same token shape it parses for --targets.
export function declarationTargets({workspaceRoot,platformId,keys=[]}) {
  const defaults=declaredDefaults({workspaceRoot,platformId});
  const targets=[];
  for(const key of keys) {
    const [kind,id]=String(key).split(':');
    const version=(defaults[kind] || {})[id];
    if(version) targets.push(`${kind}:${id}@${version}`);
  }
  return targets.sort();
}

// The version a cell is judged at, following the engine's precedence. Callers that already loaded the
// platform's defaults pass them; callers that have a platform id let this read them; callers with
// neither (a tool-wide inventory) get the pointer version unchanged.
export function resolvedCellVersion({workspaceRoot,platformId=null,kind,id,pointerVersion,defaults=null}) {
  const table=defaults || (platformId?declaredDefaults({workspaceRoot,platformId}):null);
  if(!table) return String(pointerVersion);
  return (table[kind] || {})[id] || String(pointerVersion);
}
