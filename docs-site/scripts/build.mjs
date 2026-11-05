// @ts-check
/**
 * P6 构建编排：一条命令做完「同步 → 生成 → 构建 → 复算」，并留下构建摘要。
 *
 * 用法：
 *   node scripts/build.mjs --profile internal            内网完整版（默认）
 *   node scripts/build.mjs --profile shareable           可分享版（只含 visibility=public）
 *   node scripts/build.mjs --profile internal --no-docusaurus   只跑同步与生成
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SITE_DIR, nowStamp, readJson, sha256Text, shortHash, walkFiles, writeText, exists } from './lib.mjs';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--profile');
const profile = pi >= 0 && argv[pi + 1] ? argv[pi + 1] : 'internal';
if (!['internal', 'shareable'].includes(profile)) {
  console.error(`[build] 未知 profile：${profile}`);
  process.exit(2);
}
const skipDocusaurus = argv.includes('--no-docusaurus');
const baseUrl = process.env.BASE_URL || '/';

const step = (label, args) => {
  console.log(`\n===== [build] ${label} =====`);
  const r = spawnSync(process.execPath, args, {
    cwd: SITE_DIR,
    stdio: 'inherit',
    env: { ...process.env, DOCS_PROFILE: profile, BASE_URL: baseUrl },
  });
  if (r.status !== 0) {
    console.error(`[build] 失败：${label}（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
};

step('同步白名单原文 sync-docs', [path.join('scripts', 'sync-docs.mjs'), '--profile', profile]);
step('生成三仓参考页 generate-reference', [path.join('scripts', 'generate-reference.mjs'), '--profile', profile]);

let buildInfo = null;
if (!skipDocusaurus) {
  const bin = path.join(SITE_DIR, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs');
  if (!exists(bin)) {
    console.error('[build] 找不到 Docusaurus CLI，先在 docs-site 下执行 npm install');
    process.exit(2);
  }
  console.log('\n===== [build] docusaurus build =====');
  const r = spawnSync(process.execPath, [bin, 'build', '--out-dir', path.join('build', profile)], {
    cwd: SITE_DIR,
    stdio: 'inherit',
    env: { ...process.env, DOCS_PROFILE: profile, BASE_URL: baseUrl },
  });
  if (r.status !== 0) {
    console.error(`[build] docusaurus build 失败（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
  const out = path.join(SITE_DIR, 'build', profile);
  const html = walkFiles(out, { maxDepth: 9 }).filter((f) => f.rel.endsWith('.html'));
  buildInfo = {
    outDir: `build/${profile}`,
    htmlPages: html.length,
    bytes: html.reduce((a, b) => a + b.size, 0),
    indexHtml: exists(path.join(out, 'index.html')),
  };
}

const summary = {
  schema: 'ai-docs-build/v1',
  builtAt: nowStamp(),
  profile,
  baseUrl,
  sourceLock: safeRead('data/source-lock.json'),
  generated: safeRead('data/generated-report.json'),
  build: buildInfo,
};
summary.digest = shortHash(sha256Text(JSON.stringify({
  lock: summary.sourceLock?.digest || null,
  gen: summary.generated?.digest || null,
  build: buildInfo,
})));
writeText(path.join(SITE_DIR, 'data', `build-${profile}.json`), JSON.stringify(summary, null, 2) + '\n');

console.log(`\n[build] profile=${profile} 完成，摘要 ${summary.digest}`);
if (buildInfo) console.log(`[build] 产物 build/${profile}：HTML ${buildInfo.htmlPages} 页 / ${Math.round(buildInfo.bytes / 1024)} KB，index.html=${buildInfo.indexHtml ? '有' : '无'}`);
console.log('[build] 下一步：node scripts/docs-conform.mjs --profile ' + profile);

function safeRead(rel) {
  try {
    const j = readJson(path.join(SITE_DIR, rel));
    return { digest: j.digest, generatedAt: j.generatedAt, entries: j.entries?.length ?? Object.keys(j.repos || {}).length };
  } catch {
    return null;
  }
}
