import {existsSync,lstatSync,readFileSync,rmSync} from 'node:fs';
import {sha256} from '../core/hash.mjs';
import {atomicWrite} from './kernel.mjs';
import {releaseFiles} from '../domains/resources/integrity.mjs';
import {targetPath} from '../core/paths.mjs';

export function restoreOwnedFiles(entries,transactionId) {
  const changes=[],conflicts=[];
  for(const entry of entries) {
    const beforeSha=entry.before===null?null:sha256(entry.before);
    if(existsSync(entry.target) && lstatSync(entry.target).isSymbolicLink()) {conflicts.push(entry.target);continue;}
    const current=existsSync(entry.target)?sha256(readFileSync(entry.target)):null;
    if(current===beforeSha) continue;
    if(current!==entry.afterSha256) {conflicts.push(entry.target);continue;}
    changes.push(entry);
  }
  if(conflicts.length) return {ok:false,conflicts,restored:[]};
  const restored=[];
  for(const entry of changes.reverse()) {
    // Re-check immediately before restoration; never restore over new external bytes.
    if((existsSync(entry.target)?sha256(readFileSync(entry.target)):null)!==entry.afterSha256) return {ok:false,conflicts:[entry.target],restored};
    if(entry.before===null) rmSync(entry.target); else atomicWrite(entry.target,entry.before,`${transactionId}-restore`);
    restored.push(entry.target);
  }
  return {ok:true,conflicts:[],restored};
}

export function removeOwnedDirectory(directory,expected,{remove=true}={}) {
  if(!existsSync(directory)) return {ok:true};
  if(lstatSync(directory).isSymbolicLink()) return {ok:false,conflicts:[directory]};
  try {
    const actual=releaseFiles(directory);
    for(const name of actual) if(!expected.has(name) || sha256(readFileSync(targetPath(directory,name)))!==expected.get(name)) return {ok:false,conflicts:[directory]};
    // directory is an explicitly created, validated transaction destination.
    if(remove) rmSync(directory,{recursive:true});return {ok:true};
  } catch {return {ok:false,conflicts:[directory]};}
}
