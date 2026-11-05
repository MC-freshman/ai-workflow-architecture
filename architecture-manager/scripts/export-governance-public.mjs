// Export a private maintenance source as public files, without private Git ancestry.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

const source=resolve(process.argv[2] || process.cwd());
if(!process.argv[3]) throw new Error('A fresh export destination is required');
const staging=resolve(process.argv[3]);
const previous=process.argv[4] ? resolve(process.argv[4]) : null;
if(staging===source || source.startsWith(staging+'/') || staging.startsWith(source+'/.git')) throw new Error('UNSAFE_EXPORT_DESTINATION');
if(existsSync(staging) && readdirSync(staging).length) throw new Error('Export destination must be empty; existing content is never deleted');
mkdirSync(staging,{recursive:true});
const head=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const previousHead=previous ? execFileSync('git',['-C',previous,'rev-parse','HEAD'],{encoding:'utf8'}).trim() : null;
const list=root=>execFileSync('git',['-C',root,'ls-tree','-r','--name-only','-z','HEAD'],{encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean);
const frozen=rel=>rel.match(/^((?:tool|agent|software)\/.+?\/versions\/[^/]+)\//)?.[1];
const priorPaths=previous ? list(previous) : [];
const priorReleases=new Set(priorPaths.map(frozen).filter(Boolean));
const temporary=join(dirname(staging),'private-export-'+randomUUID());
mkdirSync(temporary);
const tar=join(dirname(staging),'private-export-'+randomUUID()+'.tar');
execFileSync('git',['-C',source,'archive','--format=tar',head,'-o',tar]);
const extraction=`import sys,tarfile,re
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with tarfile.open(sys.argv[1]) as archive:
    members=[]
    for member in archive.getmembers():
        if re.match(r'^(inbox|(?:codex|qoder|zcode|dsh|doubao|workbuddy)/runtime)(?:/|$)',member.name): continue
        if not (root/member.name).resolve().is_relative_to(root) or member.issym() or member.islnk(): raise RuntimeError('Unsafe archive member')
        members.append(member)
    archive.extractall(root,members=members)
`;
execFileSync(process.env.PUBLIC_EXPORT_PYTHON || 'python',['-B','-c',extraction,tar,temporary],{maxBuffer:64*1024*1024});
unlinkSync(tar);
const paths=list(source),removed=[];
const banned=rel=>/^(?:inbox|(?:codex|qoder|zcode|dsh|doubao|workbuddy)\/runtime)(?:\/|$)/.test(rel) || /(?:^|\/)(?:node_modules|\.git|release|dist|__pycache__)(?:\/|$)/.test(rel) || /\.(?:exe|dll|msi|pyd|so|zip|7z|rar|bundle|pyc)$/i.test(rel) || /(?:^|\/)\.env(?:\.|$)/.test(rel) && !/\.env\.(?:example|sample|template)$/.test(rel);
const copy=(root,rel)=>{const target=join(staging,rel);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,rel),target);};
for(const rel of paths) {
  if(banned(rel)) {removed.push(rel);continue;}
  if(priorReleases.has(frozen(rel))) continue;
  copy(temporary,rel);
}
for(const rel of priorPaths) if(priorReleases.has(frozen(rel)) && !banned(rel)) copy(previous,rel);
if(previous && existsSync(join(previous,'LICENSE'))) copy(previous,'LICENSE');
const walk=(dir,prefix='')=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const rel=prefix ? prefix+'/'+entry.name : entry.name;return entry.isDirectory() ? walk(join(dir,entry.name),rel) : [rel];}).sort();
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const redactions=[[/D:[\\/]+ctf-competition[^\s"']*/gi,'<local-tool-body-path>'],[/C:[\\/]+Users[\\/]+wk[^\s"']*/gi,'<local-user-path>']];
const redacted=[],retainedFrozenPathReferences=[];
for(const rel of walk(staging)) {
  if(!/\.(json|md|mjs|js|ts|txt|yaml|yml|py|html|css)$/i.test(rel)) continue;
  const original=readFileSync(join(staging,rel),'utf8');
  let next=original;for(const [pattern,replacement] of redactions) next=next.replace(pattern,replacement);
  if(next===original) continue;
  if(frozen(rel)) {
    // Already-public immutable bytes are retained. New releases must be publishable intact.
    if(priorReleases.has(frozen(rel))) continue;
    if(redactions.slice(1).some(([pattern])=>{pattern.lastIndex=0;return pattern.test(original);})) throw new Error('A frozen release contains a personal home path: '+rel);
    // Historical software installation references are provenance text, not live bindings.
    retainedFrozenPathReferences.push(rel);continue;
  }
  writeFileSync(join(staging,rel),next);redacted.push(rel);
}
const provenance=[];
for(const release of [...priorReleases].sort()) {
  const members=priorPaths.filter(rel=>frozen(rel)===release);
  const changed=members.filter(rel=>existsSync(join(temporary,rel)) && digest(join(temporary,rel))!==digest(join(staging,rel)));
  if(changed.length) provenance.push({release,source:'previous-public-export',sourceHead:previousHead,filesDifferentFromPrivate:changed,immutablePublicBytesRetained:true});
}
writeFileSync(join(staging,'PUBLIC-RELEASE-PROVENANCE.json'),JSON.stringify({schema:'public-release-provenance/v1',note:'Earlier public exports redacted some frozen software recipes. This consolidation preserves their existing public bytes and records that they differ from canonical private releases; it does not silently rewrite their seals.',releases:provenance},null,2)+'\n');
writeFileSync(join(staging,'README.md'),readFileSync(new URL('./export-readme.md',import.meta.url)));
writeFileSync(join(staging,'PUBLICATION-BOUNDARY.md'),`# Publication boundary\n\nThis is a file export from private governance HEAD \`${head}\`. Private Git ancestors are not imported.\n\nIncluded: governance text, tool/agent/software registries and immutable resources, reviewed platform bridge text, docs-site sources, architecture-manager source and the historical Apache-2.0 reference snapshot.\n\nExcluded: inbox contents, all platform runtime directories, credentials, installed software directories and bytes, environments, caches and generated build output. Installers are separate GitHub Release assets. Non-frozen governance text uses local-path placeholders. Canonical frozen releases retain historical installation references in provenance text; these are not live bindings. Existing public frozen release bytes remain intact; earlier public redactions and canonical/private differences are listed in PUBLIC-RELEASE-PROVENANCE.json. Do not treat those old derivative seals as a new canonical release.\n\nOriginal third-party LICENSE/NOTICE files and source licenses retain precedence. The reference snapshot keeps Apache-2.0. The former standalone architecture-manager repository carried no separate license; consolidation does not add a new grant for that subtree.\n\nRegenerate from the private source using \`architecture-manager/scripts/export-governance-public.mjs <private-root> <empty-staging> <previous-public-checkout>\`. Review and make an ordinary public commit; never push private history or force-push.\n`);
writeFileSync(join(staging,'GITHUB-REPOSITORIES.md'),readFileSync(join(temporary,'versions/GitHub仓库收敛说明-20261009.md')));
const gitignore=join(staging,'.gitignore');
writeFileSync(gitignore,readFileSync(gitignore,'utf8')+'\n# Public export metadata\n'+['LICENSE','README.md','PUBLICATION-BOUNDARY.md','REPOSITORY-SHA256SUMS','EXPORT-MANIFEST.json','PUBLIC-RELEASE-PROVENANCE.json','GITHUB-REPOSITORIES.md'].map(p=>'!/'+p).join('\n')+'\n');
const manifest={schema:'ai-public-export-manifest/v2',generatedAt:new Date().toISOString(),sourceHead:head,previousPublicHead:previousHead,privateHistoryImported:false,removedPrefixes:['inbox/**','*/runtime/**'],removedFiles:removed,redactedFiles:redacted,retainedFrozenPathReferences,preservedPublicReleaseDirectories:priorReleases.size,nonCanonicalHistoricalPublicReleases:provenance.length};
writeFileSync(join(staging,'EXPORT-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
const all=walk(staging).filter(rel=>rel!=='REPOSITORY-SHA256SUMS');
writeFileSync(join(staging,'REPOSITORY-SHA256SUMS'),all.map(rel=>digest(join(staging,rel))+'  '+rel).join('\n')+'\n');
console.log(JSON.stringify({staging,sourceHead:head,fileCount:all.length+1,preservedPublicReleaseDirectories:priorReleases.size,historicalDerivatives:provenance.length,redacted:redacted.length}));
