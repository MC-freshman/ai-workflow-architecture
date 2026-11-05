// @ts-check
/**
 * P5 脱敏与危险内容扫描：扫 docs/ generated/ static/img/synced（可选再扫 build/ 产物）。
 * internal 与 shareable 两档判据不同：本机绝对路径在 internal 档允许、在 shareable 档算命中。
 *
 * 用法： node scripts/redact-check.mjs [--profile internal|shareable] [--include-build]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_DIR, exists, walkFiles, writeText } from './lib.mjs';

/** @type {{id:string,level:'block'|'warn',re:RegExp,desc:string,profiles:('internal'|'shareable')[]}[]} */
export const RULES = [
  { id: 'pem-private-key', level: 'block', profiles: ['internal', 'shareable'], desc: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'aliyun-ak', level: 'block', profiles: ['internal', 'shareable'], desc: '阿里云 AccessKey 形态', re: /\bLTAI[0-9A-Za-z]{12,}\b/ },
  { id: 'dashscope-key', level: 'block', profiles: ['internal', 'shareable'], desc: '百炼/DashScope key 实值', re: /\bsk-(?:sp-|ws-)?[A-Za-z0-9]{20,}\b/ },
  { id: 'kv-secret', level: 'block', profiles: ['internal', 'shareable'], desc: '键值形式的凭据实值', re: /(?:api[_-]?key|secret|passwd|password|access[_-]?token|client[_-]?secret)["'\s]*[:=]["'\s]*[A-Za-z0-9+/_\-]{16,}/i },
  { id: 'authorization-bearer', level: 'block', profiles: ['internal', 'shareable'], desc: 'Bearer 令牌实值', re: /Authorization["'\s]*[:=]["'\s]*Bearer\s+[A-Za-z0-9._\-]{16,}/i },
  { id: 'jwt', level: 'block', profiles: ['internal', 'shareable'], desc: 'JWT 实值', re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/ },
  { id: 'url-userinfo', level: 'block', profiles: ['internal', 'shareable'], desc: 'URL 内嵌账号密码', re: /:\/\/[^/\s:@]+:[^/\s@]+@[A-Za-z0-9.\-_]+/ },
  { id: 'cookie-session', level: 'warn', profiles: ['internal', 'shareable'], desc: '会话 Cookie 形态', re: /(?:Set-Cookie|sessionid|csrftoken)["'\s]*[:=]["'\s]*[A-Za-z0-9%._\-]{16,}/i },
  { id: 'user-home-path', level: 'block', profiles: ['shareable'], desc: '用户目录绝对路径', re: /[A-Za-z]:[\\/](?:Users|home)[\\/][^\\/\s`'")\]]+/i },
  { id: 'drive-path', level: 'warn', profiles: ['shareable'], desc: '本机盘符绝对路径', re: /\b[A-Za-z]:\\[^\s`'")\]]{2,}/ },
  { id: 'forbidden-tree-ref', level: 'warn', profiles: ['internal', 'shareable'], desc: '提到禁止发布的文件树（治理文本里属正常引述；真的把文件复制进来由 docs-conform 的结构检查兜住）', re: /(?:runtime[\\/]runs[\\/][0-9A-Za-z._\-]{4,}|_sources[\\/]|phpStudy_64[\\/]|\.venv[\\/])/ },
  { id: 'email', level: 'warn', profiles: ['shareable'], desc: '邮箱地址', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/ },
];

const TEXT_EXT = new Set(['.md', '.html', '.js', '.json', '.txt', '.css', '.svg', '.map']);
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const SCAN_TARGETS = ['docs', 'generated', path.join('static', 'img', 'synced')];
// 只扫本档位的产物：build/internal 里出现本机路径是设计内的，不能用 shareable 的规则去判它
const buildTarget = (profile) => path.join('build', profile);

function listTargets(dirs) {
  const out = [];
  for (const d of dirs) {
    const abs = path.join(SITE_DIR, d);
    if (!exists(abs)) continue;
    for (const f of walkFiles(abs, { maxDepth: 9 })) {
      const ext = path.extname(f.rel).toLowerCase();
      if (TEXT_EXT.has(ext)) out.push({ ...f, isText: true, area: d });
      else if (ASSET_EXT.has(ext)) out.push({ ...f, isText: false, area: d });
    }
  }
  return out;
}

export function run(profile = 'internal', opts = {}) {
  const dirs = opts.includeBuild ? [...SCAN_TARGETS, buildTarget(profile)] : SCAN_TARGETS;
  const files = listTargets(dirs);
  const findings = [];
  for (const f of files) {
    if (!f.isText) {
      if (/(?:secret|token|credential|\.pem$|\.key$|id_rsa)/i.test(path.basename(f.rel))) {
        findings.push({ rule: 'dangerous-asset-name', level: 'block', file: f.rel, excerpt: path.basename(f.rel) });
      }
      continue;
    }
    const lines = fs.readFileSync(f.abs, 'utf8').split(/\r?\n/);
    for (const rule of RULES) {
      if (!rule.profiles.includes(profile)) continue;
      lines.forEach((line, i) => {
        if (rule.re.test(line)) {
          findings.push({
            rule: rule.id,
            desc: rule.desc,
            level: rule.level,
            file: f.rel,
            line: i + 1,
            excerpt: line.trim().slice(0, 160),
          });
        }
      });
    }
  }
  return {
    schema: 'ai-docs-redact-check/v1',
    checkedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    profile,
    areas: dirs,
    filesScanned: files.length,
    rulesApplied: RULES.filter((r) => r.profiles.includes(profile)).map((r) => r.id),
    findings,
    blocking: findings.filter((f) => f.level === 'block'),
    warnings: findings.filter((f) => f.level === 'warn'),
  };
}

const self = path.resolve(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && path.resolve(process.argv[1]) === self;
if (isMain) {
  const i = process.argv.indexOf('--profile');
  const profile = i >= 0 ? process.argv[i + 1] : process.env.DOCS_PROFILE || 'internal';
  const rep = run(profile, { includeBuild: process.argv.includes('--include-build') });
  writeText(path.join(SITE_DIR, 'data', 'redact-report.json'), JSON.stringify(rep, null, 2) + '\n');
  console.log(`[redact-check] profile=${profile} 扫描 ${rep.filesScanned} 个文件：阻断 ${rep.blocking.length}，提示 ${rep.warnings.length}`);
  for (const f of rep.findings.slice(0, 20)) {
    console.log(`  [${f.level}] ${f.rule}${f.desc ? '（' + f.desc + '）' : ''} @ ${f.file}${f.line ? ':' + f.line : ''}`);
    console.log(`      ${f.excerpt}`);
  }
  if (rep.blocking.length) process.exitCode = 1;
}
