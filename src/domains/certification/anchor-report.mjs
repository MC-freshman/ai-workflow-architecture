// Panel-facing read layer for the anchored generation. The domain modules throw on purpose when
// nothing may anchor; a panel must not crash on that, so every refusal is returned as data with the
// ledger that explains it. Read-only: nothing here writes.
import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {ANCHOR_RELATIVE_PATH,anchorAlignment,anchorDigest,computeAnchor,readAnchorState} from './anchor.mjs';

// Candidate platforms are directories that carry a bridge declaration; the workspace root is not one
// of them, and a directory without a bridge has nothing to align.
export function listAnchorPlatforms({workspaceRoot}) {
  const root=targetPath(workspaceRoot,'.');
  return readdirSync(root,{withFileTypes:true})
    .filter((entry)=>entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry)=>entry.name)
    .filter((name)=>existsSync(join(root,name,'bridge.json')) || existsSync(join(root,name,'bridge','bridge.json')))
    .sort();
}

export function readAnchorReport({workspaceRoot,now=new Date().toISOString()}) {
  const root=targetPath(workspaceRoot,'.');
  const state=readAnchorState({workspaceRoot:root});
  let computed=null,refusal=null;
  try { computed=computeAnchor({workspaceRoot:root,now}); }
  catch (error) { refusal={code:error.message,rejected:error.rejected || []}; }
  const platforms=listAnchorPlatforms({workspaceRoot:root}).map((platformId)=>{
    const row={platformId};
    try {
      row.anchor=anchorAlignment({workspaceRoot:root,platformId});
      row.ok=true;
    } catch (error) {
      row.ok=false;row.error=error.message;
    }
    // Software binding presence is read separately because a missing body is a fact to show, not a
    // reason to fail the alignment report.
    let config={};
    const configRelative=[`${platformId}/bridge/runner-config.json`,`${platformId}/bridge/${platformId}-config.json`].find((path)=>existsSync(targetPath(root,path)));
    if(configRelative) { try { config=readJson(targetPath(root,configRelative)); } catch { config={}; } }
    row.software={gatewayDeclared:typeof config.softwareGateway==='string' && config.softwareGateway.length>0,
      runtimeDeclared:typeof config.softwareRuntimeRoot==='string' && config.softwareRuntimeRoot.length>0,
      environmentDeclared:typeof config.softwareEnvironment==='string' && config.softwareEnvironment.length>0};
    return row;
  });
  return {
    schema:'architecture-manager-anchor-report/v1',
    workspaceRoot:root,
    relativePath:ANCHOR_RELATIVE_PATH,
    materialised:state.exists,
    materialisedDigest:state.digest,
    matchesComputed:state.matchesComputed,
    anchor:computed,
    computedDigest:computed?anchorDigest(computed):null,
    refusal,
    platforms,
    writePerformed:false
  };
}
