// @ts-check
/**
 * docs-conform：一条命令给出站点构建的 pass/fail 判定与报告摘要（BP-3 的"机器可判项收敛成单条 conform"）。
 *
 * 判据（C1…C11）：
 *  C1  白名单结构合法（id/slug 唯一、section/status 已定义）
 *  C2  白名单点名的原文全部存在
 *  C3  来源锁一致：盘上原文 SHA-256 == source-lock 记录（漂移＝没重跑同步，不是原文被改）
 *  C4  生成物里没有手改残留（docs/ 与 generated/ 不得出现白名单之外的来源文件）
 *  C5  同步来源不得命中排除清单（runtime/_sources/本体/凭据…）
 *  C6  生成页与注册表一致（逐资源 current.json 复算 == generated-report）
 *  C7  站内链接全部可解析（无断链）
 *  C8  当前页不得把提案写成现状（链到提案页的正文必须带"提案"标注）
 *  C9  正文忠实：除链接站内化外，原文逐行都在产物里（无静默删改）
 *  C10 脱敏扫描阻断项为 0
 *  C11 构建产物存在且自洽（index.html、页面数、产物再过一次脱敏）
 *
 * 用法： node scripts/docs-conform.mjs [--profile internal|shareable] [--skip-build-check]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_ROOT, SITE_DIR, exists, globToRe, loadExclude, loadManifest, readJson,
  sha256File, sha256Text, shortHash, splitFrontMatter, walkFiles, writeText,
} from './lib.mjs';
import { run as runRedact } from './redact-check.mjs';

const argv = process.argv.slice(2);
const pIdx = argv.indexOf('--profile');
const profile = pIdx >= 0 && argv[pIdx + 1] ? argv[pIdx + 1] : process.env.DOCS_PROFILE || 'internal';
const skipBuild = argv.includes('--skip-build');
const patterns = loadExclude().map((p) => ({ ...p, re: globToRe(p.glob) }));
const checks = [];
const add = (id, title, ok, detail) => {
  checks.push({ id, title, result: ok ? 'PASS' : 'FAIL', detail });
};

const md = (dir) => walkFiles(path.join(SITE_DIR, dir), { maxDepth: 8 }).filter((f) => f.rel.endsWith('.md'));

function fmOf(abs) {
  const raw = fs.readFileSync(abs, 'utf8');
  const { fm } = splitFrontMatter(raw);
  if (!fm) return {};
  /** @type {Record<string,string>} */
  const out = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

// —— C1 / C2 ————————————————————————————————————————————————
let manifest = [];
let c1ok = true;
const c1bad = [];
try {
  manifest = loadManifest();
} catch (e) {
  c1ok = false;
  c1bad.push(String(e.message));
}
const slugs = manifest.map((e) => e.slug);
if (new Set(slugs).size !== slugs.length) { c1ok = false; c1bad.push('slug 重复'); }
if (new Set(manifest.map((e) => e.id)).size !== manifest.length) { c1ok = false; c1bad.push('id 重复'); }
add('C1', '白名单结构合法', c1ok, c1ok ? `${manifest.length} 条` : c1bad.join('; '));

const missing = manifest.filter((e) => !exists(e.kind === 'authored' ? path.join(SITE_DIR, e.authored) : path.join(AI_ROOT, e.source)))
  .map((e) => `${e.id}→${e.kind === 'authored' ? e.authored : e.source}`);
add('C2', '白名单源文件全部存在', missing.length === 0, missing.length ? missing.join(', ') : `${manifest.length}/${manifest.length}`);

// —— C3 来源锁 ————————————————————————————————————————————————
const lockPath = path.join(SITE_DIR, 'data', 'source-lock.json');
let lock = null;
try {
  lock = readJson(lockPath);
} catch { /* 记 FAIL */ }
const drift = [];
if (!lock) {
  add('C3', '来源锁存在且哈希一致', false, 'data/source-lock.json 缺失，先跑 node scripts/sync-docs.mjs');
} else {
  for (const e of lock.entries) {
    if (!e.repoRelative && e.kind !== 'authored') { drift.push(`${e.id}: 无来源路径`); continue; }
    const abs = e.kind === 'authored' ? path.join(SITE_DIR, e.origin.replace(/^docs-site\//, '')) : path.join(AI_ROOT, e.origin);
    if (!exists(abs)) { drift.push(`${e.id}: 源文件已消失 ${e.origin}`); continue; }
    const now = sha256File(abs);
    if (now !== e.sha256) drift.push(`${e.id}: 原文已变（${shortHash(e.sha256)} → ${shortHash(now)}），需重跑 sync-docs`);
    const outAbs = path.join(SITE_DIR, e.out);
    if (!exists(outAbs)) drift.push(`${e.id}: 产物缺失 ${e.out}`);
  }
  add('C3', '来源锁存在且哈希一致', drift.length === 0, drift.length ? drift.slice(0, 8).join(' | ') : `${lock.entries.length} 条逐哈希复算一致（digest ${lock.digest}）`);
}

// —— C4 生成物无手改残留 / C5 来源不碰禁区 ————————————————
const wlIds = new Set(manifest.map((e) => e.id));
const orphans = [];
for (const f of md('docs')) {
  const fm = fmOf(f.abs);
  if (!fm.id) { orphans.push(`${f.rel}（无 front-matter id，疑似手写进生成目录）`); continue; }
  if (!wlIds.has(fm.id)) orphans.push(`${f.rel}（id=${fm.id} 不在白名单）`);
}
add('C4', 'docs/ 里没有白名单之外的文件', orphans.length === 0, orphans.length ? orphans.slice(0, 6).join(' | ') : `${md('docs').length} 篇全部可追溯到白名单`);

const badSources = [];
for (const e of manifest) {
  if (e.kind !== 'source') continue;
  const hit = patterns.find((p) => p.re.test(e.source));
  if (hit) badSources.push(`${e.id} 命中排除规则 ${hit.glob}`);
}
add('C5', '同步来源不命中排除清单', badSources.length === 0, badSources.length ? badSources.join(' | ') : `${patterns.length} 条排除规则零命中`);

// —— C6 生成页与注册表一致 ————————————————————————————————
const genPath = path.join(SITE_DIR, 'data', 'generated-report.json');
let gen = null;
try {
  gen = readJson(genPath);
} catch { /* FAIL */ }
if (!gen) {
  add('C6', '参考页与注册表一致', false, 'data/generated-report.json 缺失，先跑 node scripts/generate-reference.mjs');
} else {
  const live = {
    workflows: readJson(path.join(AI_ROOT, 'tool/registry.json')).workflows,
    packs: readJson(path.join(AI_ROOT, 'tool/registry.json')).packs,
    governance: readJson(path.join(AI_ROOT, 'tool/registry.json')).governance,
    software: readJson(path.join(AI_ROOT, 'software/registry.json')).software,
    agents: readJson(path.join(AI_ROOT, 'agent/registry.json')).agents,
    contracts: readJson(path.join(AI_ROOT, 'tool/registry.json')).contracts,
  };
  const mism = [];
  const REPO_OF = { workflows: 'tool', packs: 'tool', governance: 'tool', contracts: 'tool', software: 'software', agents: 'agent' };
  for (const [key, items] of Object.entries(live)) {
    const recorded = gen.repos[key] || [];
    for (const it of items) {
      const rel = it.current || it.path || '';
      const cur = rel ? readJsonSafe(path.join(AI_ROOT, REPO_OF[key], rel)) : null;
      const v = cur?.version ?? it.version ?? cur?.snapshot ?? null;
      const rec = recorded.find((r) => r.id === it.id);
      if (!rec) { mism.push(`${key}/${it.id}：生成报告里没有`); continue; }
      if (rec.version !== v) mism.push(`${key}/${it.id}：页面 ${rec.version} ≠ 注册表 ${v}`);
    }
    for (const r of recorded) if (!items.find((i) => i.id === r.id)) mism.push(`${key}/${r.id}：生成报告多出一项`);
  }
  add('C6', '参考页与注册表一致', mism.length === 0, mism.length ? mism.slice(0, 8).join(' | ') : '逐资源 current.json 复算一致（workflows/packs/governance/software/agents/contracts）');
}

// —— C7 站内链接可解析 ——————————————————————————————————————
// front-matter 里的 slug 是"相对各自 plugin base"的，这里还原成站内绝对路由
const allMd = [...md('docs').map((f) => ({ ...f, base: '/docs' })), ...md('generated').map((f) => ({ ...f, base: '/reference' }))];
const knownRoutes = new Set(['/']);
for (const f of allMd) {
  const fm = fmOf(f.abs);
  if (fm.slug) knownRoutes.add((f.base + fm.slug).replace(/\/+$/, '') || '/');
  // 没有显式 slug 时按文件路径推导，避免误报
  const derived = `/${f.rel.split('/').slice(1).join('/').replace(/\.md$/, '').replace(/(^|\/)\d{3}-/g, '$1')}`;
  knownRoutes.add((f.base + derived).replace(/\/+$/, ''));
  knownRoutes.add((f.base + derived + '/index').replace(/\/+$/, ''));
}
try {
  for (const r of readJson(path.join(SITE_DIR, 'data', 'redirects.json')).redirects || []) {
    knownRoutes.add(String(r.to).replace(/\/+$/, '') || '/');
  }
} catch { /* 可选 */ }
knownRoutes.add('/search');
for (const t of ['/docs/tags', '/404.html']) knownRoutes.add(t);
const broken = [];
const LINK = /\]\((\/(?:docs|reference|img)\/[^)\s#]*)(#[^)\s]*)?\)/g;
for (const f of allMd) {
  const text = fs.readFileSync(f.abs, 'utf8');
  for (const m of text.matchAll(LINK)) {
    const target = m[1];
    if (target.startsWith('/img/')) {
      if (!exists(path.join(SITE_DIR, 'static', target))) broken.push(`${f.rel} → ${target}（静态资源缺失）`);
      continue;
    }
    const base = target.replace(/\/+$/, '') || '/';
    if (!knownRoutes.has(base) && !knownRoutes.has(base + '/')) broken.push(`${f.rel} → ${target}`);
  }
}
add('C7', '站内链接无断链', broken.length === 0, broken.length ? broken.slice(0, 10).join(' | ') : `${knownRoutes.size} 条路由，链接全部命中`);

// —— C8 提案不得冒充现状 ——————————————————————————————————
const proposalSlugs = new Set(manifest.filter((e) => e.status === 'proposal').map((e) => e.slug));
const violates = [];
if (proposalSlugs.size) {
  for (const f of allMd) {
    const fm = fmOf(f.abs);
    const fmTags = String(fm.tags || '');
    if (!/"current"|"companion"/.test(fmTags)) continue;
    const text = fs.readFileSync(f.abs, 'utf8');
    for (const s of proposalSlugs) {
      if (text.includes(`](${s}`) && !/提案/.test(text)) violates.push(`${f.rel} → ${s}（未标"提案"）`);
    }
  }
}
add('C8', '当前页不把提案写成现状', violates.length === 0, violates.length ? violates.join(' | ') : `提案页 ${proposalSlugs.size} 个，引用处均带标注`);

// —— C9 正文忠实性：除链接改写/降级外，原文每一行都要出现在产物里 ——————————
const unfaithful = [];
if (lock) {
  for (const e of lock.entries) {
    const srcAbs = e.kind === 'authored' ? path.join(SITE_DIR, e.origin.replace(/^docs-site\//, '')) : path.join(AI_ROOT, e.origin);
    if (!exists(srcAbs) || !exists(path.join(SITE_DIR, e.out))) continue;
    const orig = fs.readFileSync(srcAbs, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const out = fs.readFileSync(path.join(SITE_DIR, e.out), 'utf8').split('\n');
    // 去掉 front-matter 与来源横幅，再去掉原文首行 H1（由页面标题承担）
    let i = 0;
    if (out[0] === '---') { while (i < out.length && out[i] !== '---') i += 1; i += 1; }
    while (i < out.length && (out[i].startsWith('<div class="doc-meta">') || out[i].startsWith('  <') || out[i].startsWith('</div>') || out[i] === '')) i += 1;
    const body = out.slice(i);
    // 产物侧先还原渲染层转义（\~ → ~），再逐行比对，保证"忠实"判的是文字而不是转义
    const bodySet = new Set(body.map((l) => l.trim().replace(/\\~/g, '~')));
    let skippedH1 = false;
    const lost = [];
    for (const line of orig) {
      const t = line.trim();
      if (!t) continue;
      if (!skippedH1 && t.startsWith('# ')) { skippedH1 = true; continue; }
      if (t.startsWith('---') || t === '---') continue;
      // 含链接的行允许被改写（站内化 / 降级成文字），只核对不含链接的行必须逐字在
      if (/\]\(/.test(t)) continue;
      if (!bodySet.has(t)) lost.push(t.slice(0, 80));
    }
    if (lost.length) unfaithful.push(`${e.id}: ${lost.length} 行非链接正文在产物中找不到（首条：${lost[0]}）`);
  }
}
add('C9', '正文忠实（无静默删改）', unfaithful.length === 0,
  unfaithful.length ? unfaithful.slice(0, 5).join(' | ') : `${lock ? lock.entries.length : 0} 篇逐行回读：除链接站内化外原文完整保留`);

// —— C10 脱敏 ——————————————————————————————————————————————
const redact = runRedact(profile, { includeBuild: !skipBuild && exists(path.join(SITE_DIR, 'build')) });
add('C10', '脱敏扫描无阻断命中', redact.blocking.length === 0,
  redact.blocking.length
    ? redact.blocking.slice(0, 6).map((b) => `${b.rule}@${b.file}${b.line ? ':' + b.line : ''}`).join(' | ')
    : `扫描 ${redact.filesScanned} 文件，提示 ${redact.warnings.length} 条（不阻断）`);

// —— C11 产物：存在、够数、且不是旧的 ——————————————————————
if (skipBuild) {
  checks.push({ id: 'C11', title: '构建产物存在且不是旧的', result: 'SKIP', detail: '--skip-build' });
} else {
  const buildDir = path.join(SITE_DIR, 'build', profile);
  const html = exists(buildDir) ? walkFiles(buildDir, { maxDepth: 9 }).filter((f) => f.rel.endsWith('.html')) : [];
  const idx = exists(path.join(buildDir, 'index.html'));
  const minPages = profile === 'shareable' ? 3 : 20;
  let stamp = null;
  try {
    stamp = readJson(path.join(SITE_DIR, 'data', `build-${profile}.json`));
  } catch { /* 记 FAIL */ }
  const fresh = !!stamp
    && (stamp.sourceLock?.digest || null) === (lock?.digest || null)
    && (stamp.generated?.digest || null) === (gen?.digest || null);
  // 渲染回读：治理文本大量使用引用块（版本头、判据段），它必须在产物里真的是 <blockquote>。
  // 正文被上游原始 HTML 吞掉时，逐行文本比对看不出来，只有这里能抓。
  const renderIssues = [];
  if (fresh && lock) {
    for (const e of lock.entries) {
      const srcAbs = e.kind === 'authored'
        ? path.join(SITE_DIR, String(e.origin).replace(/^docs-site[/]/, ''))
        : path.join(AI_ROOT, e.origin);
      if (!exists(srcAbs)) continue;
      const src = fs.readFileSync(srcAbs, 'utf8');
      const htmlFile = path.join(SITE_DIR, 'build', profile, `${String(e.slug).replace(/^[/]+|[/]+$/g, '')}.html`);
      if (!exists(htmlFile)) continue;
      const out = fs.readFileSync(htmlFile, 'utf8');
      if (/^> +[^>\s]/m.test(src) && !out.includes('<blockquote')) {
        renderIssues.push(`${e.id}: 原文有引用块，产物里没有 <blockquote>`);
      }
      if (out.includes('&gt; **') || /\n&gt; /.test(out)) {
        renderIssues.push(`${e.id}: 产物里出现被转义的引用行（正文被上游 HTML 吞了）`);
      }
    }
  }
  const rendered = renderIssues.length === 0;
  add('C11', '构建产物存在、不是旧的、且渲染保真', idx && html.length >= minPages && fresh && rendered,
    !idx ? `build/${profile}/index.html 不存在（先 npm run build）`
      : !stamp ? `HTML ${html.length} 页，但缺 data/build-${profile}.json，无法证明产物对应当前来源`
      : !fresh ? `HTML ${html.length} 页，但构建摘要记的是 ${stamp.sourceLock?.digest}/${stamp.generated?.digest}，当前是 ${lock?.digest}/${gen?.digest} —— 产物是旧的，重跑 npm run build${profile === 'shareable' ? ':shareable' : ''}`
      : !rendered ? `构建摘要一致，但渲染回读失败：${renderIssues.slice(0, 4).join(' | ')}`
      : `HTML ${html.length} 页（门槛 ${minPages}），构建摘要与来源锁/注册表一致，引用块渲染回读通过`);
}

const failed = checks.filter((c) => c.result === 'FAIL');
const report = {
  schema: 'ai-docs-conform/v1',
  checkedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  profile,
  verdict: failed.length ? 'FAIL' : 'PASS',
  counts: {
    pass: checks.filter((c) => c.result === 'PASS').length,
    fail: failed.length,
    skip: checks.filter((c) => c.result === 'SKIP').length,
  },
  checks,
  sourceLockDigest: lock?.digest || null,
  generatedDigest: gen?.digest || null,
  redactFindings: { blocking: redact.blocking.length, warnings: redact.warnings.length },
};
report.digest = sha256Text(JSON.stringify(checks.map((c) => `${c.id}:${c.result}:${c.detail}`)));
writeText(path.join(SITE_DIR, 'data', 'conform-report.json'), JSON.stringify(report, null, 2) + '\n');

const icon = { PASS: '✓', FAIL: '✗', SKIP: '·' };
console.log(`[docs-conform] profile=${profile} → ${report.verdict}（PASS ${report.counts.pass} / FAIL ${report.counts.fail} / SKIP ${report.counts.skip}），摘要 ${shortHash(report.digest)}`);
for (const c of checks) {
  console.log(`  ${icon[c.result]} ${c.id} ${c.title} — ${c.result}`);
  if (c.result !== 'PASS') console.log(`      ${c.detail}`);
}
if (failed.length) process.exitCode = 1;

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
