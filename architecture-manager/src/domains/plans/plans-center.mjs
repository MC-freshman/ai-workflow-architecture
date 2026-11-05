// Plan center (3.5.0 P6): parse P-step tables out of the implementation
// documents under versions/, so the GUI can show each P's blocks, artifacts
// and acceptance criteria without copying content anywhere. Status text stays
// with the documents themselves (edited through the document plan flow).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { targetPath } from '../../core/paths.mjs';

const plain=value=>value.replace(/\*\*|`/g,'').trim();
const columns={id:/^(P|步骤|阶段|步)$/i,name:/名称|任务|内容|工作项/,duration:/时长|耗时|时间/,blocks:/子块|实施|操作|怎么做/,artifacts:/产物|输出|交付/,criteria:/判据|验收|通过条件/,status:/状态|进度/};

function splitCells(line) {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

export function parseImplementationTables(workspaceRoot) {
  const root = resolve(workspaceRoot);
  const versionsDir = targetPath(root, 'versions');
  if (!existsSync(versionsDir)) return { versionsDir, documents: [] };
  const documents = [];
  for (const entry of readdirSync(versionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join('versions', entry.name);
    const text = readFileSync(join(versionsDir, entry.name), 'utf8');
    const steps = [];
    let header=null;
    for (const line of text.split(/\r?\n/)) {
      if(!line.trim().startsWith('|')) {header=null;continue;}
      const cells=splitCells(line).map(plain);
      if(cells.every(cell=>/^:?-+:?$/.test(cell)))continue;
      if(cells.some(cell=>columns.id.test(cell))){header=Object.fromEntries(Object.entries(columns).map(([key,pattern])=>[key,cells.findIndex(cell=>pattern.test(cell))]));continue;}
      if(!header || header.id<0)continue;
      const match=/^((?:[A-Z]+-)?P\d+[A-Za-z]?)(?:\s+|[（(]|$)(.*)$/.exec(cells[header.id] || '');if(!match)continue;
      const at=key=>header[key]>=0?cells[header[key]] || null:null;
      steps.push({
        id:match[1],name:at('name') || match[2].trim(),duration:at('duration'),blocks:at('blocks'),artifacts:at('artifacts'),criteria:at('criteria'),status:at('status')
      });
    }
    if (steps.length > 0) documents.push({ path: `versions/${entry.name}`, steps });
  }
  return { versionsDir, documents };
}
