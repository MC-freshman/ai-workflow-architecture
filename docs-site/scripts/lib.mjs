// @ts-check
/**
 * docs-site 构建链共用工具（零第三方依赖，只用 Node 内置模块）。
 * 事实来源永远是 E:\ai 的原文；本文件只做读取、哈希、复制、链接重写，绝不写回原文。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AI_ROOT = path.resolve(SITE_DIR, '..');

/** 站点栏目（左侧分类）定义 */
export const SECTIONS = {
  'quick-start': { label: '快速开始', position: 1, description: '本站怎么用、项目怎么读' },
  architecture: { label: '架构与治理', position: 2, description: '上位原则、基线、判据与台账' },
  runtime: { label: '运行契约', position: 3, description: '调用适配、版本锁、交接包与资源仲裁' },
  platforms: { label: '平台操作', position: 4, description: '各平台的接入说明、调用入口与边界' },
  resources: { label: '必要资源说明', position: 5, description: '当前稳定且直接影响治理操作的工具说明' },
  history: { label: '变更与历史', position: 6, description: '时间线、历史基线、提案与开放事项' },
};

/** 状态徽章口径：读者必须能一眼分清「现在有效」和「当时这么说」 */
export const STATUS = {
  current: { text: '当前有效', tone: 'ok' },
  companion: { text: '配套现行', tone: 'info' },
  history: { text: '历史基线', tone: 'warn' },
  frozen: { text: '冻结历史', tone: 'muted' },
  proposal: { text: '提案 · 未定稿', tone: 'danger' },
};

export const GENERATED_SECTIONS = {
  workflows: { label: '工作流目录', position: 1 },
  packs: { label: '能力包目录', position: 2 },
  governance: { label: '治理工具目录', position: 3 },
  agents: { label: '专家目录', position: 4 },
  software: { label: '软件配方目录', position: 5 },
  contracts: { label: '运行时契约', position: 6 },
  skills: { label: '技能目录快照', position: 7 },
  platforms: { label: '平台状态', position: 8 },
  meta: { label: '关于本目录', position: 9 },
};

/** 平台清单（顺序固定，供目录页与平台页复用） */
export const PLATFORMS = ['codex', 'qoder', 'zcode', 'workbuddy', 'doubao', 'dsh'];

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export const writeText = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
};

export const exists = (p) => fs.existsSync(p);

export const sha256Text = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const sha256File = (p) => sha256Text(fs.readFileSync(p, 'utf8'));
export const shortHash = (h) => (h ? String(h).slice(0, 12) : '—');

export const toPosix = (p) => String(p).split(path.sep).join('/');
export const relToRoot = (p) => toPosix(path.relative(AI_ROOT, path.resolve(p)));

export function loadManifest() {
  const file = path.join(SITE_DIR, 'data', 'docs-manifest.json');
  const m = readJson(file);
  const seen = new Set();
  for (const e of m.entries) {
    if (seen.has(e.id)) throw new Error(`manifest 重复 id: ${e.id}`);
    seen.add(e.id);
    if (!SECTIONS[e.section]) throw new Error(`manifest ${e.id} 的 section 未定义: ${e.section}`);
    if (!STATUS[e.status]) throw new Error(`manifest ${e.id} 的 status 未定义: ${e.status}`);
    if (e.kind === 'source' && !e.source) throw new Error(`${e.id}: kind=source 必须有 source`);
    if (e.kind === 'authored' && !e.authored) throw new Error(`${e.id}: kind=authored 必须有 authored`);
    if (!e.slug) throw new Error(`manifest ${e.id} 缺 slug`);
  }
  return m.entries;
}

export function loadExclude() {
  return readJson(path.join(SITE_DIR, 'data', 'exclude.json')).patterns;
}

/** 把 ** / * 通配翻成正则（输入路径统一用 / 分隔） */
export function globToRe(glob) {
  const
    DIR = '@@DIR@@',
    ANY = '@@ANY@@';
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = esc
    .replace(/\*\*\//g, DIR)
    .replace(/\*\*/g, ANY)
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(DIR, 'g'), '(?:[^/]*\\/)*')
    .replace(new RegExp(ANY, 'g'), '.*');
  return new RegExp('^' + re + '$');
}

export function isExcluded(relPath, patterns = loadExclude()) {
  const p = toPosix(relPath);
  return patterns.find((pat) => globToRe(pat.glob).test(p)) || null;
}

/** 递归列出目录下所有文件（相对 E:\\ai 的 posix 路径），带排除裁剪 */
export function walkFiles(absDir, opts = {}) {
  const out = [];
  const maxDepth = opts.maxDepth ?? 8;
  const exts = opts.exts ?? null;
  const base = path.resolve(absDir);
  const skipDirs = new Set(opts.skipDirs ?? ['.git', 'node_modules', '.docusaurus', 'build', '__pycache__']);
  const stack = [[base, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipDirs.has(ent.name) || depth + 1 >= maxDepth) continue;
        stack.push([full, depth + 1]);
      } else if (ent.isFile()) {
        if (exts && !exts.includes(path.extname(ent.name).toLowerCase())) continue;
        out.push({ rel: relToRoot(full), abs: full, size: fs.statSync(full).size });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function sourceAbs(entry) {
  return entry.kind === 'authored'
    ? path.join(SITE_DIR, entry.authored)
    : path.join(AI_ROOT, entry.source);
}

/** 原文里出现的相对路径 / 绝对路径 → E:\ai 相对 posix 路径 */
export function normalizeLinkTarget(target, fromRel) {
  let t = String(target).trim().replace(/\\/g, '/');
  const drive = /^[A-Za-z]:\//;
  if (drive.test(t)) {
    const abs = path.resolve(t.replace(/\//g, path.sep));
    return { kind: 'root', rel: relToRoot(abs) };
  }
  if (t.startsWith('/')) return { kind: 'external', rel: t };
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return { kind: 'external', rel: t };
  const baseDir = path.dirname(path.join(AI_ROOT, fromRel));
  return { kind: 'file', rel: relToRoot(path.resolve(baseDir, t)) };
}

const LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g;

/**
 * 链接改写：白名单内 → 站内 slug；白名单外的真实文件 → 标注"未收录"的纯文本；
 * 外链与页内锚点原样保留。返回 { text, stats }。
 */
export function rewriteLinks(md, fromRel, resolver) {
  const stats = { rewritten: 0, uncited: 0, external: 0, anchors: 0, images: 0, missing: 0, siteAbs: 0 };
  const text = md.replace(LINK_RE, (whole, bang, label, target) => {
    if (target.startsWith('#')) {
      stats.anchors += 1;
      return whole;
    }
    const hashIdx = target.indexOf('#');
    const filePart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    const anchor = hashIdx >= 0 ? target.slice(hashIdx) : '';
    if (!filePart) {
      stats.anchors += 1;
      return whole;
    }
    if (filePart.startsWith('/')) {
      // 站内绝对地址：默认原样交给 Docusaurus 与 docs-conform 校验
      if (typeof resolver.siteAbs === 'function') {
        const dropTo = resolver.siteAbs(filePart);
        if (dropTo) {
          stats.uncited += 1;
          return `${label || filePart}*（当前构建档位未收录）*`;
        }
      }
      stats.siteAbs += 1;
      return whole;
    }
    if (bang) {
      // 图片：能定位到本地文件就复制进 static，否则降级成文字
      const handled = resolver.image(filePart, fromRel);
      if (handled) {
        stats.images += 1;
        return `![${label}](${handled}${anchor})`;
      }
      stats.missing += 1;
      return `（图片未收录：\`${filePart}\`）`;
    }
    if (/^(?:https?:|mailto:)/i.test(filePart)) {
      stats.external += 1;
      return whole;
    }
    const slug = resolver.toSlug(filePart, fromRel);
    if (slug) {
      stats.rewritten += 1;
      return `[${label || slug}](${slug}${anchor})`;
    }
    const resolved = normalizeLinkTarget(filePart, fromRel);
    const real = resolved.kind !== 'external' && exists(path.join(AI_ROOT, resolved.rel));
    if (real) stats.uncited += 1;
    else stats.missing += 1;
    const note = real ? '未收录于本站' : '本站未定位到该文件';
    return `${label || filePart}*（${note}：\`${resolved.rel}\`）*`;
  });
  return { text, stats };
}

/**
 * 把"单个 ~"转义成 \~，防止 remark-gfm 把同段两个 ~ 配成删除线吞掉整段条文
 * （治理文本大量用 `BP-1~BP-4`、`P0~P10` 写范围）。
 * 只动正文：围栏代码块与反引号内的 ~ 一律不碰；`~~真删除线~~` 保持原样。
 * 这是渲染层的等价转义，不改变可读文本；C9 逐行回读时会先还原再比对。
 */
export function escapeLoneTildes(md) {
  let inFence = false;
  return md.split('\n').map((line) => {
    const t = line.trimStart();
    if (t.startsWith('```') || t.startsWith('~~~')) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line
      .split(/(`[^`]+`)/)
      .map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/(?<!~)~(?!~)/g, '\\~')))
      .join('');
  }).join('\n');
}

export function splitFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

const FM_ORDER = ['id', 'title', 'sidebar_label', 'sidebar_key', 'sidebar_position', 'slug', 'description', 'tags', 'hide_table_of_contents'];

/** 写 front-matter：只用 Docusaurus 认得的标量键，值一律 JSON 引号化 */
export function frontMatter(fields) {
  const lines = [];
  const keys = [...FM_ORDER.filter((k) => k in fields), ...Object.keys(fields).filter((k) => !FM_ORDER.includes(k))];
  for (const k of keys) {
    const v = fields[k];
    if (v === undefined || v === null) continue;
    lines.push(`${k}: ${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/** 页首来源横幅（.md + markdown.format=detect 下原始 HTML 可用） */
export function metaBanner(ctx) {
  const st = STATUS[ctx.status];
  const rows = [
    ['状态', `<span class="pill pill--${st.tone}">${st.text}</span>`],
    ['事实来源', ctx.sourceLabel],
    ['源文件 SHA-256', `<code>${shortHash(ctx.sourceSha)}</code>`],
    ['原文最近修改', ctx.sourceMtime],
    ['本站审核', ctx.reviewedAt],
    ['发布档位', ctx.visibility === 'public' ? '可对外（进 shareable 产物）' : '仅内部（internal 产物）'],
  ];
  if (ctx.extra) rows.push(...ctx.extra);
  const table = rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('\n    ');
  return [
    '<div class="doc-meta">',
    '  <table>',
    `    ${table}`,
    '  </table>',
    `  <p class="doc-meta__note">${ctx.note ?? '本页正文由构建脚本从事实来源原样同步；原文未被修改，反向编辑本页无效。'}</p>`,
    '</div>',
    '',
  ].join('\n');
}

export function gitReadout() {
  // 只读 git 读数，不改仓库状态
  const run = (args) => {
    try {
      const { execFileSync } = require('node:child_process');
      return execFileSync('git', args, { cwd: AI_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return { head: run(['rev-parse', '--short', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) };
}

export const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export function mtimeIso(p) {
  try {
    return fs.statSync(p).mtime.toISOString().replace(/\.\d+Z$/, 'Z');
  } catch {
    return '—';
  }
}
