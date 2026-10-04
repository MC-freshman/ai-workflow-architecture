import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffDocument, buildDocsSite } from '../src/docs-ops.mjs';
import { parseImplementationTables } from '../src/plans-center.mjs';

const TABLE_DOC = `# 实施表 fixture

| P | 时长 | 子块 | 产物 | 判据 |
|---|---|---|---|---|
| **P0 边界冻结** | 2 h | ① 甲；② 乙 | baseline | 全部可回读 |
| **P1 实现** | 2.5 h | ① 丙 | 模块 + 测试 | 全绿 |

 unrelated text
`;

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'am-plans-'));
  mkdirSync(join(root, 'versions'), { recursive: true });
  writeFileSync(join(root, 'versions', '架构X-实施表.md'), TABLE_DOC);
  return root;
}

test('parses P-step tables out of versions/ documents', () => {
  const root = makeFixture();
  const parsed = parseImplementationTables(root);
  assert.equal(parsed.documents.length, 1);
  assert.equal(parsed.documents[0].path, 'versions/架构X-实施表.md');
  const [p0, p1] = parsed.documents[0].steps;
  assert.equal(p0.id, 'P0');
  assert.equal(p0.name, '边界冻结');
  assert.equal(p0.duration, '2 h');
  assert.match(p0.criteria, /全部可回读/);
  assert.equal(p1.id, 'P1');
  rmSync(root, { recursive: true, force: true });
});
test('ordinary and bold P tables are mapped by headers, including reordered columns and progress-only tables',()=>{
  const root=makeFixture();writeFileSync(join(root,'versions','plain.md'),'| 状态 | P | 判据 | 产物 | 时长 | 子块 |\n|---|---|---|---|---|---|\n| 待执行 | P12 工作流 | 可调用 | 新版本 | 2 h | 两块 |\n\n| P | 状态 | 说明 |\n|---|---|---|\n| **P13** | 完成 | 实测 |\n');const steps=parseImplementationTables(root).documents.find(row=>row.path.endsWith('plain.md')).steps;assert.equal(steps[0].id,'P12');assert.equal(steps[0].criteria,'可调用');assert.equal(steps[0].status,'待执行');assert.equal(steps[1].status,'完成');assert.equal(steps[1].criteria,null);rmSync(root,{recursive:true,force:true});
});

test('diffDocument reads a git diff read-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'am-diff-'));
  execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 't@t.local'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
  mkdirSync(join(root, 'versions'), { recursive: true });
  writeFileSync(join(root, 'versions', 'a.md'), 'one\n');
  execFileSync('git', ['-C', root, 'add', '--', 'versions/a.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-m', 'init'], { stdio: 'ignore' });
  writeFileSync(join(root, 'versions', 'a.md'), 'one\ntwo\n');
  const result = diffDocument(root, 'versions/a.md');
  assert.equal(result.empty, false);
  assert.match(result.diff, /\+two/);
  const clean = diffDocument(root, 'versions/missing.md');
  rmSync(root, { recursive: true, force: true });
});

test('docs-site operations fail with structured errors when the site is absent', () => {
  const root = makeFixture();
  assert.throws(() => buildDocsSite(root), /DOCS_SITE_MISSING/);
  rmSync(root, { recursive: true, force: true });
});
