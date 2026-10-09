// Compatibility export. All selection decisions are implemented in one domain.
import {certificationSnapshot} from '../domains/certification/fingerprints.mjs';
import {legacyCoverage} from '../domains/certification/evidence.mjs';
import {selectCertification} from '../domains/certification/selection.mjs';
export function patchCertificationSelection(proof,root,id,config) {
  try {
    const snapshot=certificationSnapshot(root,id,config);
    const baseline=legacyCoverage(root,id,{firstCertification:proof},snapshot);
    if(!baseline) return null;
    const selection=selectCertification(snapshot,baseline,{mode:'quick'});
    return selection.kind==='full'?null:selection.only;
  } catch {return null;}
}
