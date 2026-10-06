import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {certificationFixture} from './support/certification.mjs';
import {seedRelease,seedPointer} from './support/resources.mjs';
import {certificationSnapshot} from '../src/domains/certification/fingerprints.mjs';
import {certificationSelection} from '../src/domains/certification/selection.mjs';
import {mergeCertification,matrixSummary} from '../src/domains/certification/evidence.mjs';

// The platform declaration must reach the snapshot, not only the judge command line. When only the
// judge honoured the declaration, a cell that had actually passed was rejected at merge time with
// CERTIFICATION_SELECTION_MISMATCH: the row reported version X while the snapshot still described the
// shared pointer's version Y.
test('the snapshot inventory follows the platform declaration, so a passing row is not rejected at merge',(t)=>{
  const f=certificationFixture(t);
  const cellKey='workflow:expert-task';
  assert.equal(f.snapshot().cells[cellKey].version,'1.0.0','without a declaration the shared pointer decides');

  seedRelease(f.root,'tool','expert-task','2.0.0');seedPointer(f.root,'tool','expert-task','2.0.0');
  const bridge=join(f.root,f.id,'bridge.json');
  mkdirSync(join(f.root,f.id),{recursive:true});
  writeFileSync(bridge,JSON.stringify({schema:'ai-platform-bridge/v1.1',platform:f.id,defaults:{workflowVersions:{'expert-task':'2.0.0'}}},null,2)+'\n');

  const declared=f.snapshot();
  assert.equal(declared.cells[cellKey].version,'2.0.0','the declared version wins over the shared pointer, exactly as the engine resolves it');

  // A row judged at the declared version merges; the same row at the pointer version must not.
  const directory=join(f.root,f.id,'runtime/manager-check','declared-attempt');mkdirSync(directory,{recursive:true});
  const conform=join(directory,'conform.json');
  writeFileSync(conform,JSON.stringify({floorReached:true,counts:{pass:1,declaredAbsent:0,unverified:0}}));
  // The merge rebuilds a complete coverage set, so every cell the snapshot knows must be present.
  const cellRows=(version)=>Object.keys(declared.cells).map((key)=>f.positive(key===cellKey?{...declared.cells[key],version}:declared.cells[key]));
  const write=(name,version)=>{const path=join(directory,name);const rows=cellRows(version);writeFileSync(path,JSON.stringify({schema:'ai-invocation-matrix/v1',rows,summary:matrixSummary(rows)}));return path;};
  const selection=certificationSelection(f.root,f.id,declared,{mode:'full'});

  const mismatched=write('mismatch.json','1.0.0');
  assert.throws(()=>mergeCertification(f.root,f.id,declared,selection,mismatched,conform,directory),/CERTIFICATION_SELECTION_MISMATCH/,
    'a row judged at another version must still be refused');

  const aligned=write('aligned.json','2.0.0');
  const merged=mergeCertification(f.root,f.id,declared,selection,aligned,conform,directory);
  assert.notEqual(merged,null,'a row judged at the declared version is the correct row for that cell');
  assert.equal(merged.provenance.actualRows,Object.keys(declared.cells).length);
});

test('a cell whose version the platform does not declare keeps the shared pointer',(t)=>{
  const f=certificationFixture(t);
  seedRelease(f.root,'tool','expert-task','2.0.0');seedPointer(f.root,'tool','expert-task','2.0.0');
  mkdirSync(join(f.root,f.id),{recursive:true});
  writeFileSync(join(f.root,f.id,'bridge.json'),JSON.stringify({schema:'ai-platform-bridge/v1.1',platform:f.id,defaults:{workflowVersions:{'some-other-workflow':'9.9.9'}}},null,2)+'\n');
  assert.equal(f.snapshot().cells['workflow:expert-task'].version,'2.0.0','the shared pointer still decides for undeclared cells');
});
