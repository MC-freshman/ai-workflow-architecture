import {existsSync} from 'node:fs';
import {targetPath} from '../../core/paths.mjs';
import {parseJson,readJson} from '../../core/json.mjs';
import {validateFrozenResource} from './versions.mjs';

const shapes={tool:{schema:'ai-tool-registry/v2',sections:['workflows','skills','packs']},agent:{schema:'ai-agent-registry/v2',sections:['agents']},software:{schema:'ai-software-registry/v1',sections:['software']}};
export function validateRegistry(root,repository,text,{validateReleases=true,onlyIds=null}={}) {
  const registry=parseJson(text),shape=shapes[repository];
  if(!shape || registry?.schema!==shape.schema || !Number.isInteger(registry.version) || registry.version<1) throw Error('REGISTRY_SCHEMA_INVALID');
  if(!shape.sections.some(section=>Array.isArray(registry[section]))) throw Error('REGISTRY_SECTION_REQUIRED');
  const context={seen:new Set(),visiting:new Set()};
  for(const section of shape.sections) {
    if(registry[section]!==undefined && !Array.isArray(registry[section])) throw Error('REGISTRY_SECTION_INVALID');
    const ids=new Set();
    for(const entry of registry[section] || []) {
      if(!entry || typeof entry.id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.id) || typeof entry.enabled!=='boolean' || ids.has(entry.id)) throw Error('REGISTRY_ENTRY_INVALID');
      ids.add(entry.id);
      if(entry.kind==='skill-catalog') {
        const catalog=readJson(targetPath(root,`${repository}/${entry.path}`));
        if(!['ai-skill-catalog/v1','ai-skill-registry/v1'].includes(catalog.schema) || !Array.isArray(catalog.skills)) throw Error('REGISTRY_CATALOG_INVALID');
        continue;
      }
      const prefix=['skills','packs'].includes(section)?section+'/':'';
      const expected=`${prefix}${entry.id}/current.json`;
      if(entry.current!==expected) throw Error('REGISTRY_POINTER_PATH_INVALID');
      const file=targetPath(root,`${repository}/${entry.current}`);
      if(!existsSync(file)) throw Error('REGISTRY_POINTER_MISSING');
      const pointer=readJson(file);
      if(pointer.id!==entry.id || typeof pointer.version!=='string' || !/^\d+\.\d+\.\d+/.test(pointer.version) || pointer.hashManifest!=='SHA256SUMS') throw Error('REGISTRY_POINTER_INVALID');
      if(validateReleases && entry.enabled && (!onlyIds || onlyIds.has(entry.id))) validateFrozenResource(root,repository,entry.id,pointer.version,context,prefix);
    }
  }
  return registry;
}
