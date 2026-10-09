import {existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readJson} from '../../core/json.mjs';
import {targetPath} from '../../core/paths.mjs';
import {compareStableVersions} from '../../core/versions.mjs';
import {validateFrozenResource} from '../resources/versions.mjs';

export function recommendedMatrixVersion(root) {
  const base=targetPath(root,'tool/architecture-ops/versions');
  if(!existsSync(base)) return null;
  for(const version of readdirSync(base).filter(version=>/^\d+\.\d+\.\d+$/.test(version)).sort(compareStableVersions).reverse()) {
    try {
      const result=validateFrozenResource(root,'tool','architecture-ops',version);
      const source=join(base,version,'SOURCE.json');
      if(existsSync(source) && ['candidate','draft','unpublished'].includes(readJson(source).releaseStatus)) continue;
      if(result.manifest.interface?.invocationSmoke==='ai-invocation-smoke/v1') return version;
    } catch { /* Only recommend complete, frozen compatible judges. */ }
  }
  return null;
}

export function recommendedCertificationPair(root) {
  const base=targetPath(root,'tool/wf-runner/versions');
  if(!existsSync(base)) return null;
  const versions=readdirSync(base).filter(version=>/^\d+\.\d+\.\d+$/.test(version)).sort(compareStableVersions).reverse();
  for(const version of versions) {
    try {
      const manifest=readJson(targetPath(base,version+'/manifest.json'));
      if(manifest.interface?.['x-invocationSmoke']!=='ai-invocation-smoke/v1') continue;
      const sourcePath=targetPath(base,version+'/SOURCE.json');
      if(existsSync(sourcePath) && ['candidate','draft','unpublished'].includes(readJson(sourcePath).releaseStatus)) continue;
      const scanner=manifest.dependencies?.workflows?.['repo-lint'];
      const contracts=readJson(targetPath(root,'tool/runtime-contracts/current.json')).version;
      validateFrozenResource(root,'tool','wf-runner',version);
      validateFrozenResource(root,'tool','runtime-contracts',contracts);
      const matrixVersion=recommendedMatrixVersion(root);
      if(!matrixVersion) continue;
      return {runnerVersion:version,scannerVersion:scanner,contractsVersion:contracts,matrixVersion,interface:manifest.interface['x-invocationSmoke'],adopted:false};
    } catch { /* Never recommend an unfrozen or still developing release. */ }
  }
  return null;
}
