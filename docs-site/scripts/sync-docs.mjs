// @ts-check
/**
 * P3 同步链路：把白名单里的原文复制成 docs/ 下的构建输入。
 *
 * 铁律：
 *  1. 只读 E:\ai 原文，一个字节都不写回去；
 *  2. docs/ 是生成物（.gitignore 已排除），要改内容改原文或白名单，不改 docs/；
 *  3. 每份同步下来的文件都记源路径 + 源 SHA-256 + 原文 mtime，供 docs-conform 复算。
 *
 * 用法： node scripts/sync-docs.mjs [--profile internal|shareable]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_ROOT, SITE_DIR, SECTIONS, exists, frontMatter, loadManifest, metaBanner, mtimeIso,
  escapeLoneTildes, normalizeLinkTarget, readJson, relToRoot, rewriteLinks, sha256File, sha256Text, shortHash,
  sourceAbs, splitFrontMatter, writeText,
} from './lib.mjs';

const DOCS_BASE = '/docs';
const DOCS_OUT = path.join(SITE_DIR, 'docs');
const IMG_OUT = path.join(SITE_DIR, 'static', 'img', 'synced');

function argProfile() {
  const i = process.argv.indexOf('--profile');
  const p = i >= 0 ? process.argv[i + 1] : process.env.DOCS_PROFILE || 'internal';
  if (!['internal', 'shareable'].includes(p)) throw new Error(`未知 profile: ${p}`);
  return p;
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const profile = argProfile();
const manifest = loadManifest().filter((e) => (profile === 'shareable' ? e.visibility === 'public' : true));

// 源路径 → 站点 URL 的索引（含未选中条目，链接改写成"未收录"文案时也要用到）
const allEntries = loadManifest();
const byOrigin = new Map();
for (const e of allEntries) {
  const origin = e.kind === 'authored' ? `docs-site/${e.authored}` : e.source;
  byOrigin.set(path.posix.normalize(origin), e);
}

// shareable 档的站内绝对链接口径
const publicSlugs = new Set(allEntries.filter((e) => e.visibility === 'public').map((e) => e.slug));
const REF_SHAREABLE_DIRS = ['', 'workflows', 'packs', 'governance', 'agents', 'software', 'contracts', 'skills', 'meta'];

const resolver = {
  /** 站内绝对链接：shareable 档要把未收录的目标降级成文字 */
  siteAbs(target) {
    if (profile !== 'shareable') return false;
    const t = String(target).replace(/\/+$/, '') || '/';
    if (t === '/') return false;
    if (t.startsWith('/reference')) {
      const dir = t.split('/')[2] || '';
      return !REF_SHAREABLE_DIRS.includes(dir);
    }
    return !publicSlugs.has(t);
  },
  /** @param {string} target @param {string} fromRel @returns {string|null} */
  toSlug(target, fromRel) {
    const n = normalizeLinkTarget(target, fromRel);
    if (n.kind === 'external') return null;
    const rel = path.posix.normalize(n.rel.replace(/^\.\.\//, ''));
    const hit = byOrigin.get(rel);
    if (!hit) return null;
    if (profile === 'shareable' && hit.visibility !== 'public') return null;
    return hit.slug;
  },
  /** 图片：能在盘上定位就复制进 static/img/synced/，返回站内路径 */
  image(target, fromRel) {
    const n = normalizeLinkTarget(target, fromRel);
    if (n.kind === 'external') return null;
    const abs = path.join(AI_ROOT, n.rel);
    if (!exists(abs) || !fs.statSync(abs).isFile()) return null;
    if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(n.rel)) return null;
    const h = shortHash(sha256File(abs));
    const out = path.join(IMG_OUT, `${h}-${path.basename(n.rel)}`);
    fs.mkdirSync(IMG_OUT, { recursive: true });
    fs.copyFileSync(abs, out);
    return `/img/synced/${path.basename(out)}`;
  },
};

resetDir(DOCS_OUT);
fs.rmSync(IMG_OUT, { recursive: true, force: true });

/** @type {{origin:string|null,rel:string|null,bytes:number,sha256:string,mtime:string,slug:string,status:string,visibility:string,section:string,out:string,links:Record<string,number>,note:string|null}[]} */
const lockEntries = [];

for (const e of manifest) {
  const abs = sourceAbs(e);
  if (!exists(abs)) throw new Error(`${e.id}: 找不到内容文件 ${abs}`);
  const raw = fs.readFileSync(abs, 'utf8');
  const { body: rawBody } = splitFrontMatter(raw);
  let body = rawBody.replace(/\r\n/g, '\n');

  // 原文首行 H1 由 front-matter 的 title 承担，去掉以免一页两个标题
  let droppedH1 = null;
  body = body.replace(/^# +(.+)\n+/, (_, t) => {
    droppedH1 = t.trim();
    return '';
  });

  const originRel = e.kind === 'authored' ? `docs-site/${e.authored}` : e.source;
  const { text, stats } = rewriteLinks(body, originRel, resolver);
  const outText = escapeLoneTildes(text);

  const banner = metaBanner({
    status: e.status,
    sourceLabel: e.kind === 'authored'
      ? `<code>${originRel}</code>（本站撰写的导览页）`
      : `<code>${e.source}</code>（E:\\ai 原文，构建时只读同步）`,
    sourceSha: sha256File(abs),
    sourceMtime: mtimeIso(abs),
    reviewedAt: e.reviewedAt || '—',
    visibility: e.visibility,
    extra: [
      ['原文字节', `${Buffer.byteLength(raw, 'utf8').toLocaleString('en-US')} B`],
      ['本页地址', `<code>${e.slug}</code>`],
    ],
  });

  const outRel = `docs/${e.section}/${String(e.order).padStart(3, '0')}-${e.id}.md`;
  const fm = frontMatter({
    id: e.id,
    title: e.title,
    sidebar_label: e.sidebarLabel || e.title,
    sidebar_key: 'docs',
    sidebar_position: e.order,
    slug: e.slug.replace(new RegExp(`^${DOCS_BASE}`), ''),
    description: e.summary || e.title,
    tags: [e.section, e.status],
  });

  writeText(
    path.join(SITE_DIR, outRel),
    fm + banner + '\n' + outText.trimEnd() + '\n',
  );

  lockEntries.push({
    id: e.id,
    kind: e.kind,
    origin: e.kind === 'authored' ? `docs-site/${e.authored}` : e.source,
    repoRelative: e.kind === 'authored' ? null : e.source,
    bytes: Buffer.byteLength(raw, 'utf8'),
    sha256: sha256File(abs),
    mtime: mtimeIso(abs),
    title: e.title,
    section: e.section,
    status: e.status,
    visibility: e.visibility,
    slug: e.slug,
    out: outRel,
    links: stats,
    droppedH1,
    note: e.note || null,
  });
}

// 分类元数据（左侧分类的标题与顺序）
for (const [key, sec] of Object.entries(SECTIONS)) {
  const dir = path.join(DOCS_OUT, key);
  if (!fs.existsSync(dir)) continue;
  writeText(
    path.join(dir, '_category_.json'),
    JSON.stringify({ label: sec.label, position: sec.position, collapsible: true }, null, 1) + '\n',
  );
}

const lock = {
  schema: 'ai-docs-source-lock/v1',
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  profile,
  docsBase: DOCS_BASE,
  counts: {
    entries: lockEntries.length,
    source: lockEntries.filter((x) => x.kind === 'source').length,
    authored: lockEntries.filter((x) => x.kind === 'authored').length,
    bytes: lockEntries.reduce((a, b) => a + b.bytes, 0),
  },
  links: lockEntries.reduce((a, x) => {
    for (const [k, v] of Object.entries(x.links || {})) a[k] = (a[k] || 0) + v;
    return a;
  }, {}),
  digest: shortHash(sha256Text(lockEntries.map((x) => `${x.id}:${x.sha256}`).join('|'))),
  entries: lockEntries,
};
writeText(path.join(SITE_DIR, 'data', 'source-lock.json'), JSON.stringify(lock, null, 2) + '\n');

console.log(`[sync-docs] profile=${profile} 同步 ${lockEntries.length} 篇（原文 ${lock.counts.source} / 撰写 ${lock.counts.authored}，${(lock.counts.bytes / 1024).toFixed(0)} KB）`);
console.log(`[sync-docs] 链接：改写为站内页 ${lock.links.rewritten || 0}，站内绝对地址 ${lock.links.siteAbs || 0}，标注未收录 ${lock.links.uncited || 0}，外链 ${lock.links.external || 0}，锚点 ${lock.links.anchors || 0}，未定位 ${lock.links.missing || 0}`);
console.log(`[sync-docs] 来源锁 digest=${lock.digest} → data/source-lock.json`);
