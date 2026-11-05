// @ts-check
/**
 * P1 盘点：只读扫描 E:\ai 的 Markdown 面，产出 data/inventory.json。
 * 不改任何原文档；白名单（data/docs-manifest.json）之外的一律只登记、不发布。
 *
 * 用法： node scripts/inventory.mjs
 */
import path from 'node:path';
import {
  AI_ROOT, SITE_DIR, exists, globToRe, loadExclude, loadManifest,
  sha256File, walkFiles, writeText,
} from './lib.mjs';

// 'ai学习笔记' 已于 2026-09-29 迁入 inbox/（它此前从未在根级建出实体），故不再作为根级扫描项
const DOC_ROOTS = ['.', 'versions', 'tool', 'agent', 'software', 'codex', 'qoder', 'zcode',
  'workbuddy', 'doubao', 'dsh', 'inbox'];

const patterns = loadExclude().map((p) => ({ ...p, re: globToRe(p.glob) }));
const siteSelf = globToRe('docs-site/**');

const seen = new Map();
for (const root of DOC_ROOTS) {
  const abs = path.join(AI_ROOT, root);
  if (!exists(abs)) continue;
  for (const f of walkFiles(abs, { exts: ['.md'], maxDepth: 7 })) {
    if (seen.has(f.rel)) continue;
    let excludedBy = null;
    let reason = null;
    if (siteSelf.test(f.rel)) {
      excludedBy = 'docs-site/**';
      reason = '本站自身目录，不是被盘点的对象';
    } else {
      const hit = patterns.find((p) => p.re.test(f.rel));
      if (hit) {
        excludedBy = hit.glob;
        reason = hit.reason;
      }
    }
    seen.set(f.rel, { path: f.rel, bytes: f.size, excludedBy, reason });
  }
}

const manifest = loadManifest();
const whitelisted = manifest.filter((e) => e.kind === 'source').map((e) => e.source);
const wl = new Set(whitelisted);
const missing = whitelisted.filter((s) => !exists(path.join(AI_ROOT, s)));

const rows = [...seen.values()]
  .map((r) => ({ ...r, published: wl.has(r.path) }))
  .sort((a, b) => a.path.localeCompare(b.path));

const byRoot = {};
for (const r of rows) {
  const root = r.path.includes('/') ? r.path.split('/')[0] : '(根目录)';
  const b = (byRoot[root] ||= { files: 0, bytes: 0, published: 0, excluded: 0 });
  b.files += 1;
  b.bytes += r.bytes;
  if (r.published) b.published += 1;
  if (r.excludedBy) b.excluded += 1;
}

const report = {
  schema: 'ai-docs-inventory/v1',
  scannedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  totals: {
    markdownCandidates: rows.length,
    bytes: rows.reduce((a, b) => a + b.bytes, 0),
    publishedSources: rows.filter((r) => r.published).length,
    publishedBytes: rows.filter((r) => r.published).reduce((a, b) => a + b.bytes, 0),
    manifestEntries: manifest.length,
    authoredEntries: manifest.length - wl.size,
    missingWhitelistSources: missing,
  },
  byRoot,
  whitelist: manifest.map((e) => ({
    id: e.id,
    section: e.section,
    status: e.status,
    visibility: e.visibility,
    slug: e.slug,
    origin: e.kind === 'authored' ? `docs-site/${e.authored}` : e.source,
    sha256: e.kind === 'authored'
      ? (exists(path.join(SITE_DIR, e.authored)) ? sha256File(path.join(SITE_DIR, e.authored)) : null)
      : (exists(path.join(AI_ROOT, e.source)) ? sha256File(path.join(AI_ROOT, e.source)) : null),
  })),
  files: rows,
};

writeText(path.join(SITE_DIR, 'data', 'inventory.json'), JSON.stringify(report, null, 2) + '\n');

const t = report.totals;
console.log(`[inventory] Markdown 候选 ${t.markdownCandidates} 份 / ${(t.bytes / 1048576).toFixed(1)} MB`);
console.log(`[inventory] 白名单 ${t.manifestEntries} 条（原文 ${t.publishedSources} 份 / ${(t.publishedBytes / 1024).toFixed(0)} KB，站点撰写 ${t.authoredEntries} 篇）`);
if (missing.length) console.log(`[inventory] 白名单里缺失的源文件 ${missing.length} 个：${missing.join(', ')}`);
for (const [k, v] of Object.entries(byRoot)) {
  console.log(`  ${k}: ${v.files} 份（发布 ${v.published}，排除 ${v.excluded}，${(v.bytes / 1024).toFixed(0)} KB）`);
}
console.log('[inventory] 报告 → data/inventory.json');
