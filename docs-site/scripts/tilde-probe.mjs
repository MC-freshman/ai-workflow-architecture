// @ts-check
/**
 * 文件形式的波浪号语义探针。
 *
 * 不从 shell 接受正则或待搜索文本，所有匹配规则都固定在本文件中，
 * 用来避免 PowerShell / cmd 对 \~、~~ 等字符的二次解释。
 *
 * 判定口径：
 *   1. 源文档正文中的 `~~文本~~` 是作者明确写下的删除线候选；
 *   2. 源正文中的单个 `~` 是范围写法候选，应在同步层变为 `\\~`；
 *   3. 同步 Markdown 保留 `~~文本~~`，并且单个 `~` 不再以裸字符出现；
 *   4. HTML 中的 `<del>` 数量应等于源正文中可渲染的删除线候选数量。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SITE_DIR, loadManifest, readJson, writeText } from './lib.mjs';

const ROOT = path.resolve(SITE_DIR, '..');
const REPORT = path.join(SITE_DIR, 'data', 'tilde-probe.json');
const profiles = ['internal', 'shareable'];

function read(abs) {
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
}

function bodyWithoutFrontMatter(raw) {
  if (!raw.startsWith('---\n')) return raw;
  const end = raw.indexOf('\n---\n', 4);
  return end >= 0 ? raw.slice(end + 5) : raw;
}

function bodyWithoutGeneratedTitle(raw) {
  const body = bodyWithoutFrontMatter(raw);
  return body.replace(/^# +[^\n]*\n+/, '');
}

function lineInfo(text, lineNo, column, kind, value, context) {
  return { line: lineNo, column, kind, value, context: context.trim().slice(0, 240) };
}

/**
 * 只统计正文中的 Markdown 语义；围栏代码和反引号代码内的波浪号不参与作者语义计数。
 * @param {string} raw
 */
function inspectMarkdown(raw) {
  const text = bodyWithoutGeneratedTitle(raw);
  const lines = text.split('\n');
  const strikes = [];
  const singles = [];
  let inFence = false;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // 逐行匹配 GFM 删除线；跨行的 ~~ 不属于本项目当前写法。
    for (const m of line.matchAll(/~~([^~\r\n]+?)~~/g)) {
      strikes.push(lineInfo(line, lineNo, m.index + 1, 'strike', m[0], line));
    }

    // 去掉反引号代码片段后再数单波浪号，避免把代码示例当成正文范围写法。
    const prose = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
    for (let i = 0; i < prose.length; i += 1) {
      if (prose[i] !== '~' || prose[i - 1] === '~' || prose[i + 1] === '~') continue;
      singles.push(lineInfo(line, lineNo, i + 1, 'single', '~', line));
    }
  });

  return { strikeCount: strikes.length, singleCount: singles.length, strikes, singles };
}

function countSyncedEscapedSingles(raw) {
  const text = bodyWithoutGeneratedTitle(raw);
  const lines = text.split('\n');
  let escaped = 0;
  let bare = 0;
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const prose = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
    for (let i = 0; i < prose.length; i += 1) {
      if (prose[i] !== '~' || prose[i - 1] === '~' || prose[i + 1] === '~') continue;
      if (i > 0 && prose[i - 1] === '\\') escaped += 1;
      else bare += 1;
    }
  }
  return { escaped, bare };
}

function htmlStrikeCount(raw) {
  return (raw.match(/<del\b/gi) || []).length;
}

function htmlPath(profile, slug) {
  const route = String(slug).replace(/^\/+|\/+$/g, '');
  return path.join(SITE_DIR, 'build', profile, `${route}.html`);
}

const manifest = loadManifest();
const results = [];
const totals = {
  sourceFiles: 0,
  sourceStrikePairs: 0,
  sourceSingleTildes: 0,
  syncedEscapedSingles: 0,
  syncedBareSingles: 0,
  htmlDelInternal: 0,
  htmlDelShareable: 0,
};

for (const entry of manifest) {
  const sourceAbs = entry.kind === 'authored'
    ? path.join(SITE_DIR, entry.authored)
    : path.join(ROOT, entry.source);
  if (!fs.existsSync(sourceAbs)) continue;
  const source = inspectMarkdown(read(sourceAbs));
  totals.sourceFiles += 1;
  totals.sourceStrikePairs += source.strikeCount;
  totals.sourceSingleTildes += source.singleCount;

  const row = {
    id: entry.id,
    title: entry.title,
    source: entry.kind === 'authored' ? `docs-site/${entry.authored}` : entry.source,
    slug: entry.slug,
    status: entry.status,
    visibility: entry.visibility,
    sourceStats: source,
    synced: {},
    html: {},
  };

  const lockPath = path.join(SITE_DIR, 'data', 'source-lock.json');
  const lock = readJson(lockPath);
  const locked = lock?.entries?.find((x) => x.id === entry.id);
  const syncedAbs = locked ? path.join(SITE_DIR, locked.out) : null;
  if (syncedAbs && fs.existsSync(syncedAbs)) {
    const syncedRaw = read(syncedAbs);
    const synced = inspectMarkdown(syncedRaw);
    const singles = countSyncedEscapedSingles(syncedRaw);
    row.synced = {
      profile: lock.profile,
      strikeCount: synced.strikeCount,
      escapedSingleCount: singles.escaped,
      bareSingleCount: singles.bare,
      sourceStrikeMatches: synced.strikeCount === source.strikeCount,
      sourceSingleMatches: singles.escaped === source.singleCount && singles.bare === 0,
    };
    totals.syncedEscapedSingles += singles.escaped;
    totals.syncedBareSingles += singles.bare;
  }
  for (const profile of profiles) {
    const htmlAbs = htmlPath(profile, entry.slug);
    if (fs.existsSync(htmlAbs)) {
      const del = htmlStrikeCount(read(htmlAbs));
      row.html[profile] = {
        delCount: del,
        sourceStrikeMatches: del === source.strikeCount,
      };
      if (profile === 'internal') totals.htmlDelInternal += del;
      else totals.htmlDelShareable += del;
    }
  }
  results.push(row);
}

const strikeRows = results.flatMap((r) => r.sourceStats.strikes.map((s) => ({
  id: r.id,
  source: r.source,
  status: r.status,
  visibility: r.visibility,
  ...s,
})));

const report = {
  schema: 'ai-docs-tilde-probe/v1',
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  method: 'file-based-node-probe',
  scope: 'docs-manifest entries and their generated internal/shareable pages',
  totals,
  authorStrikeCandidates: strikeRows,
  results,
  assertions: {
    everySourceStrikeHasInternalDel: results.every((r) => r.html.internal?.sourceStrikeMatches !== false),
    everySyncedSourceStrikePreserved: results.every((r) => r.synced?.sourceStrikeMatches !== false),
    everySourceSingleEscaped: results.every((r) => r.synced?.sourceSingleMatches !== false),
    noBareSyncedSingles: totals.syncedBareSingles === 0,
  },
};

writeText(REPORT, JSON.stringify(report, null, 2) + '\n');

console.log(JSON.stringify({
  report: path.relative(SITE_DIR, REPORT),
  totals,
  assertions: report.assertions,
  strikeCandidates: strikeRows.length,
}, null, 2));

if (Object.values(report.assertions).some((v) => v === false)) process.exitCode = 1;
