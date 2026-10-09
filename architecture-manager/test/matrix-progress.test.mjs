import assert from 'node:assert/strict';
import test from 'node:test';
import { matrixProgressDecoder } from '../src/core/matrix-progress.mjs';

test('matrix progress only uses complete actual events, including split Chinese text', () => {
  const events=[]; const decode=matrixProgressDecoder('test-platform',event=>events.push(event));
  const text=JSON.stringify({schema:'ai-invocation-matrix-event/v1',completed:1,total:2,row:{kind:'workflow',id:'alpha',status:'FAIL',durationMs:1234}})+'\n';
  decode(text.slice(0,40)); assert.equal(events.length,0); decode(text.slice(40));
  assert.equal(events[0].completed,1); assert.equal(events[0].total,2); assert.match(events[0].phase,/失败/);
  decode('noise\n'+JSON.stringify({schema:'wrong',completed:2,total:2})+'\n');
  assert.equal(events.length,1);
});
