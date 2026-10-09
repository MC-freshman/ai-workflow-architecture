import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function parseTestEvidence(stdout = '') {
  const row = {};
  for(const key of ['tests','pass','fail','skipped','cancelled']) {
    const values=[...stdout.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];
    row[key]=values.length?Number(values.at(-1)[1]):null;
  }
  row.valid=row.tests>0 && row.pass>0 && row.fail===0 && row.cancelled===0 && row.pass+row.skipped===row.tests;
  row.reason=row.valid?null:row.tests===0?'NO_TESTS':row.tests==null?'TEST_SUMMARY_MISSING':row.pass===0?'NO_EXECUTED_TESTS':'TEST_SUMMARY_FAILED_OR_INCONSISTENT';
  return row;
}

export function sourceSnapshot(root) {
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const files=(directory,prefix)=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const filename=path.join(directory,entry.name),name=prefix+entry.name;
    if(entry.isSymbolicLink() || fs.lstatSync(filename).isSymbolicLink()) throw Error('CONFORM_SOURCE_LINK');
    return entry.isDirectory()?files(filename,name+'/'):[{path:name,sha256:sha(fs.readFileSync(filename))}];
  });
  return [...['src','scripts','test'].flatMap(name=>files(path.join(root,name),name+'/')),...['package.json','package-lock.json','eslint.config.mjs'].map(name=>({path:name,sha256:sha(fs.readFileSync(path.join(root,name)))}))].sort((a,b)=>a.path.localeCompare(b.path));
}
