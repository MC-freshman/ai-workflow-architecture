// @ts-check
/**
 * P4 参考页生成：三仓注册表 + 逐资源 current.json + SHA256SUMS + 各平台 capabilities.json
 * → generated/ 下的目录页与版本卡片。所有数字都从盘上复算，不手工抄版本号。
 *
 * 用法： node scripts/generate-reference.mjs [--profile internal|shareable]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_ROOT, GENERATED_SECTIONS, SITE_DIR, exists, frontMatter, loadExclude,
  nowStamp, readJson, rewriteLinks, sha256File, sha256Text, shortHash, walkFiles, writeText, globToRe, PLATFORMS,
} from './lib.mjs';

const OUT = path.join(SITE_DIR, 'generated');
const REF_BASE = '/reference';

function argProfile() {
  const i = process.argv.indexOf('--profile');
  return i >= 0 ? process.argv[i + 1] : process.env.DOCS_PROFILE || 'internal';
}
const profile = argProfile();

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const code = (s) => '`' + String(s).replace(/`/g, '´') + '`';
const tbl = (header, rows) => [
  '| ' + header.join(' | ') + ' |',
  '|' + header.map(() => '---').join('|') + '|',
  ...rows.map((r) => '| ' + r.map((c) => esc(c)).join(' | ') + ' |'),
].join('\n');

const GENERATED_NOTE = (sources) => [
  '> [!note] 本页由脚本生成',
  '> 数据来源：' + sources.map((s) => code(s)).join('、') + '。',
  '> 重新生成：`node scripts/generate-reference.mjs`；一致性核对：`node scripts/docs-conform.mjs`。',
  '> 手工改本页会在下次生成时被覆盖——要改事实，改注册表或原文。',
].join('\n');

function readIfJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function countLines(p) {
  if (!exists(p)) return null;
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
}

/** 逐资源指针 + 版本目录 + 完整性清单的复算结果 */
function inspectItem(repoDir, item) {
  const id = item.id;
  const curRel = item.current || item.path;
  const curAbs = curRel ? path.join(AI_ROOT, repoDir, curRel) : null;
  const pointer = curAbs ? readIfJson(curAbs) : null;
  const versionsDir = curAbs ? path.join(path.dirname(curAbs), 'versions') : null;
  const versions = versionsDir && exists(versionsDir)
    ? fs.readdirSync(versionsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  const v = pointer?.version ?? item.version ?? pointer?.snapshot ?? null;
  const vDir = v && versionsDir && exists(path.join(versionsDir, v)) ? path.join(versionsDir, v) : null;
  const manifest = vDir ? readIfJson(path.join(vDir, 'manifest.json')) : null;
  const sums = vDir ? countLines(path.join(vDir, pointer?.hashManifest || 'SHA256SUMS')) : null;
  const files = vDir
    ? walkFiles(vDir, { maxDepth: 6, skipDirs: new Set(['.git', '__pycache__', 'node_modules']) })
    : [];
  return {
    id,
    repo: repoDir,
    pointerRel: curRel ? `${repoDir}/${curRel}` : null,
    pointer,
    version: v,
    pointerMatchesDir: v ? versions.includes(v) : null,
    versions,
    versionDirRel: vDir ? path.relative(AI_ROOT, vDir).split(path.sep).join('/') : null,
    versionsDirRel: versionsDir ? path.relative(AI_ROOT, versionsDir).split(path.sep).join('/') : null,
    manifest,
    sumsCount: sums,
    fileCount: files.length,
    totalBytes: files.reduce((a, b) => a + b.size, 0),
    registry: item,
  };
}

function pill(text, tone) {
  return `<span class="pill pill--${tone}">${text}</span>`;
}

function page(file, fm, body, sources) {
  const note = GENERATED_NOTE(sources);
  // slug 在这里写的是站内绝对地址；plugin-content-docs 把它当 routeBasePath 的相对值，故剥掉前缀
  const rel = { ...fm, sidebar_key: 'reference' };
  if (rel.slug) rel.slug = String(rel.slug).replace(/^\/reference/, '') || '/';
  writeText(path.join(OUT, file), frontMatter(rel) + '\n' + note + '\n\n' + body + '\n');
}

function cardPages(list, opts) {
  const rowsOut = [];
  for (const it of list) {
    const m = it.manifest || {};
    const r = it.registry;
    const body = [];
    body.push(`# ${m.displayName || it.id}`);
    body.push('');
    body.push(tbl(
      ['字段', '值（复算自盘上文件）'],
      [
        ['资源 ID', code(it.id)],
        ['所属仓库', code(it.repo)],
        ['当前版本', it.version ? pill(it.version, 'ok') : pill('未解析', 'danger')],
        ['版本指针', it.pointerRel ? code(it.pointerRel) : '—'],
        ['指针 schema', it.pointer?.schema || '—'],
        ['指针登记的版本目录', it.pointerMatchesDir === null ? '—' : (it.pointerMatchesDir ? '存在' : '缺失（注册表与目录不一致）')],
        ['可用版本目录', it.versions.length ? it.versions.join(' · ') : '—'],
        ['完整性清单', it.sumsCount ? `SHA256SUMS ${it.sumsCount} 行` : '无'],
        ['版本目录文件数', it.fileCount ? `${it.fileCount} 个 / ${Math.round(it.totalBytes / 1024)} KB` : '—'],
        ['注册表 enabled', String(r.enabled ?? '—')],
        ['invocable', String(r.invocable ?? '—')],
        ...(r.kind ? [['kind', code(r.kind)]] : []),
        ...(Array.isArray(r.transports) && r.transports.length ? [['transports', r.transports.join(' · ')]] : []),
        ...(m.schema ? [['manifest schema', code(m.schema)]] : []),
        ...(m.mode ? [['mode', code(m.mode)]] : []),
        ...(m.role ? [['role', m.role]] : []),
        ...(m.entry ? [['entry', code(m.entry)]] : []),
      ],
    ));
    if (m.dependencies && Object.keys(m.dependencies).length) {
      body.push('', '## 依赖锁', '', tbl(['依赖面', '声明'], Object.entries(m.dependencies).map(([k, v]) => {
        const ent = Array.isArray(v) ? v.join(' · ') : Object.keys(v || {}).join(' · ');
        return [k, ent ? code(ent) : '（空）'];
      })));
    }
    if (m.permissions) {
      body.push('', '## 权限声明', '', tbl(['维度', '值'], Object.entries(m.permissions).map(([k, v]) => [k, code(v)])));
    }
    if (m.workflows?.length) {
      body.push('', `绑定工作流：${m.workflows.map((w) => code(w)).join('、')}`);
    }
    if (m.toolLock) {
      const lock = readIfJson(path.join(AI_ROOT, it.versionDirRel, m.toolLock));
      body.push('', '## 精确 tool-lock', '', '专家内部调用服从下列钉版（' + code(it.versionDirRel + '/' + m.toolLock) + '）：', '',
        lock ? '```json\n' + JSON.stringify(lock, null, 2) + '\n```' : '（该文件读不到，按未声明处理）');
    }
    if (m.capabilities?.length || m.capabilities) {
      body.push('', '## capabilities', '', '```json', JSON.stringify(m.capabilities, null, 2), '```');
    }
    if (opts.extra) body.push('', opts.extra(it));
    if (it.versions.length) {
      body.push('', '## 逐版本', '', tbl(
        ['版本', '版本目录', 'SHA256SUMS', '是当前'],
        it.versions.map((v) => {
          const dirRel = `${it.versionsDirRel}/${v}`;
          const sumsP = path.join(AI_ROOT, dirRel, it.pointer?.hashManifest || 'SHA256SUMS');
          return [v, code(dirRel), exists(sumsP) ? `${countLines(sumsP)} 行` : '无', v === it.version ? '是' : ''];
        }),
      ));
    }
    const fm = {
      id: `${opts.dir}-${it.id}`,
      title: m.displayName || it.id,
      sidebar_label: it.id,
      sidebar_position: opts.positionBase + list.indexOf(it),
      slug: `${REF_BASE}/${opts.dir}/${it.id}`,
      description: `${it.repo} / ${it.id} 当前版本 ${it.version || '未解析'}（脚本复算）`,
    };
    page(`${opts.dir}/${it.id}.md`, fm, body.join('\n'), opts.sources);
    rowsOut.push(it);
  }
  return rowsOut;
}

function indexPage(dir, label, list, opts) {
  const rows = list.map((it) => [
    `[${it.id}](/reference/${dir}/${it.id})`,
    it.version || '未解析',
    it.versions.length,
    it.sumsCount ?? 0,
    String(it.registry.enabled ?? '—'),
    String(it.registry.invocable ?? '—'),
    it.registry.kind || '—',
  ]);
  const body = [
    `# ${label}`,
    '',
    `共 **${list.length}** 项。当前版本一律取各资源自己的 \`current.json\`，完整性行数为该版本目录 \`SHA256SUMS\` 的非空行数。`,
    '',
    tbl(['资源', '当前版本', '版本目录数', 'SHA256SUMS 行', 'enabled', 'invocable', 'kind'], rows),
    '',
    opts?.note || '',
  ].join('\n');
  page(`${dir}/index.md`, {
    id: `ref-${dir}-index`,
    title: label,
    sidebar_label: '总表',
    sidebar_position: 0,
    slug: `${REF_BASE}/${dir}`,
    description: `${label}（注册表自动生成）`,
  }, body, opts?.sources || [`tool/registry.json`]);
}

function category(dir) {
  const sec = GENERATED_SECTIONS[dir] || { label: dir, position: 99 };
  writeText(path.join(OUT, dir, '_category_.json'), JSON.stringify({ label: sec.label, position: sec.position, collapsible: true }, null, 1) + '\n');
}

// —— 开始生成 ————————————————————————————————————————————————
fs.rmSync(OUT, { recursive: true, force: true });

const toolReg = readJson(path.join(AI_ROOT, 'tool/registry.json'));
const agentReg = readJson(path.join(AI_ROOT, 'agent/registry.json'));
const swReg = readJson(path.join(AI_ROOT, 'software/registry.json'));

const groups = {
  workflows: { dir: 'workflows', label: '工作流目录', items: toolReg.workflows, repo: 'tool', sources: ['tool/registry.json', 'tool/<id>/current.json'] },
  packs: { dir: 'packs', label: '能力包目录', items: toolReg.packs, repo: 'tool', sources: ['tool/registry.json', 'tool/packs/<id>/current.json'] },
  governance: { dir: 'governance', label: '治理工具目录', items: toolReg.governance, repo: 'tool', sources: ['tool/registry.json', 'tool/<id>/current.json'] },
  software: { dir: 'software', label: '软件配方目录', items: swReg.software, repo: 'software', sources: ['software/registry.json', 'software/<id>/current.json'] },
};

const built = { repos: {}, platforms: [], counts: {} };

// workflows / packs / governance / software
for (const [key, g] of Object.entries(groups)) {
  const list = g.items.map((it) => inspectItem(g.repo, it));
  fs.mkdirSync(path.join(OUT, g.dir), { recursive: true });
  category(g.dir);
  cardPages(list, { dir: g.dir, positionBase: 1, sources: g.sources, extra: key === 'software' ? softwareExtra : undefined });
  indexPage(g.dir, g.label, list, { sources: g.sources, note: key === 'software' ? softwareIndexNote(list) : undefined });
  built.repos[key] = list.map((x) => ({ id: x.id, version: x.version, versions: x.versions, sums: x.sumsCount }));
  built.counts[g.dir] = list.length;
}

// agents
{
  const list = agentReg.agents.map((it) => inspectItem('agent', it));
  fs.mkdirSync(path.join(OUT, 'agents'), { recursive: true });
  category('agents');
  cardPages(list, { dir: 'agents', positionBase: 1, sources: ['agent/registry.json', 'agent/<id>/current.json'] });
  indexPage('agents', '专家目录', list, { sources: ['agent/registry.json', 'agent/<id>/current.json'] });
  built.repos.agents = list.map((x) => ({ id: x.id, version: x.version, versions: x.versions, sums: x.sumsCount }));
  built.counts.agents = list.length;
}

// 契约：runtime-contracts 当前版本的契约文本同步进 generated/contracts
{
  const rc = inspectItem('tool', toolReg.contracts[0]);
  fs.mkdirSync(path.join(OUT, 'contracts'), { recursive: true });
  category('contracts');
  cardPages([rc], { dir: 'contracts', positionBase: 1, sources: ['tool/registry.json', 'tool/runtime-contracts/current.json'] });
  const contractFiles = rc.versionDirRel
    ? walkFiles(path.join(AI_ROOT, rc.versionDirRel, 'contracts'), { exts: ['.md'], maxDepth: 3 })
    : [];
  let pos = 10;
  for (const f of contractFiles) {
    const raw = fs.readFileSync(f.abs, 'utf8');
    const name = path.basename(f.rel, '.md');
    const first = /^# +(.+)$/m.exec(raw);
    // 契约原文里的相对链接指向 tool 仓内部路径，本站不发布它们 → 降级成文字，避免断链
    const body = rewriteLinks(raw.replace(/^# +.+$/m, '').trim(), f.rel, {
      toSlug: () => null,
      image: () => null,
    }).text;
    page(`contracts/${name}.md`, {
      id: `contract-${name}`,
      title: first ? first[1].trim() : name,
      sidebar_label: first ? first[1].trim() : name,
      sidebar_position: pos++,
      slug: `${REF_BASE}/contracts/${name}`,
      description: `runtime-contracts ${rc.version} 的 ${name} 契约（原样同步）`,
    }, [
      `# ${first ? first[1].trim() : name}`,
      '',
      tbl(['字段', '值'], [
        ['契约包', code(`runtime-contracts@${rc.version}`)],
        ['原文路径', code(f.rel)],
        ['源文件 SHA-256', code(shortHash(sha256File(f.abs)))],
      ]),
      '',
      body,
    ].join('\n'), [f.rel]);
    built.counts[`contract-${name}`] = 1;
  }
  built.repos.contracts = [{ id: rc.id, version: rc.version, versions: rc.versions, sums: rc.sumsCount }];
}

// 技能目录（catalog 快照，不进版本卡片区）
{
  const items = toolReg.skills || [];
  const rows = items.map((s) => {
    const j = readIfJson(path.join(AI_ROOT, 'tool', s.path));
    return [
      `[${s.id}](/reference/skills/${s.id})`,
      j?.snapshot || '—',
      Array.isArray(j?.skills) ? j.skills.length : 0,
      String(s.enabled ?? '—'),
      j?.schema || '—',
    ];
  });
  fs.mkdirSync(path.join(OUT, 'skills'), { recursive: true });
  category('skills');
  indexPage('skills', '技能目录快照', items.map((s, i) => ({ ...inspectItem('tool', s), id: s.id })), {
    sources: ['tool/registry.json', 'tool/_registry/*.json'],
  });
  for (const s of items) {
    const j = readIfJson(path.join(AI_ROOT, 'tool', s.path));
    const list = Array.isArray(j?.skills) ? j.skills : [];
    page(`skills/${s.id}.md`, {
      id: `skillcat-${s.id}`,
      title: s.id,
      sidebar_label: s.id,
      sidebar_position: 1,
      slug: `${REF_BASE}/skills/${s.id}`,
      description: `${s.id} 技能目录快照（${j?.snapshot || '未标快照'}，${list.length} 条）`,
    }, [
      `# ${s.id}`,
      '',
      tbl(['字段', '值'], [
        ['schema', code(j?.schema || '—')],
        ['sourceId', code(j?.sourceId || '—')],
        ['快照号', code(j?.snapshot || '—')],
        ['条目数', String(list.length)],
        ['注册表路径', code(`tool/${s.path}`)],
      ]),
      '',
      '技能条目为上游快照索引，正文不随本站发布（见排除清单 `tool/_sources/**`）。',
      '',
      tbl(['skill id', '版本', '源路径'], list.slice(0, 400).map((k) => [k.id || '—', k.version || '—', code(k.sourcePath || '—')])),
    ].join('\n'), [`tool/${s.path}`]);
  }
  built.counts.skills = items.length;
}

// 平台状态页（读各平台 bridge/capabilities.json，结论不互抄）——shareable 档不发布平台自证细节
if (profile !== 'shareable') {
  fs.mkdirSync(path.join(OUT, 'platforms'), { recursive: true });
  category('platforms');
  const overview = [];
  let pos = 1;
  for (const p of PLATFORMS) {
    const capsRel = `${p}/bridge/capabilities.json`;
    const caps = readIfJson(path.join(AI_ROOT, capsRel)) || readIfJson(path.join(AI_ROOT, `${p}/capabilities.json`));
    const bridge = readIfJson(path.join(AI_ROOT, `${p}/bridge.json`));
    const hasPlatformDoc = exists(path.join(AI_ROOT, p, 'bridge', 'platform.md')) || exists(path.join(AI_ROOT, p, 'platform.md'));
    const checks = caps?.checks || {};
    const passed = Object.entries(checks).filter(([, v]) => v === true).map(([k]) => k);
    const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
    const absent = listAbs(caps?.declaredAbsent);
    const unver = listAbs(caps?.unverified);
    page(`platforms/${p}.md`, {
      id: `platform-${p}`,
      title: `平台状态 · ${p}`,
      sidebar_label: p,
      sidebar_position: pos++,
      slug: `${REF_BASE}/platforms/${p}`,
      description: `${p} 的能力自证读数（读自其自己的 capabilities.json）`,
    }, [
      `# 平台状态 · ${p}`,
      '',
      tbl(['字段', '值'], [
        ['能力快照 schema', code(caps?.schema || '—')],
        ['自证时间 attestedAt', caps?.attestedAt || '—'],
        ['通过项 checks', `${passed.length} 项`],
        ['未通过 / 非 true 项', failed.length ? failed.join(' · ') : '无'],
        ['declaredAbsent', absent.length ? `${absent.length} 项` : '0 项'],
        ['unverified', unver.length ? `${unver.length} 项` : '0 项'],
        ['平台章 platform.md', hasPlatformDoc ? '存在' : '不存在'],
        ['bridge.json', bridge ? '存在' : '不存在'],
      ]),
      '',
      '## 已通过的能力项',
      '',
      passed.length ? passed.map((k) => `- ${k}`).join('\n') : '（无）',
      '',
      '## declaredAbsent（待补台账，不是"本平台不支持"）',
      '',
      absent.length ? tbl(['能力', '补齐路径', '成本'], absent.map((a) => [a.name, a.path || '—', a.cost || '—'])) : '无（0 项）',
      '',
      '## 未核验 unverified',
      '',
      unver.length ? unver.map((a) => `- ${a.name}${a.reason ? ' — ' + a.reason : ''}`).join('\n') : '无',
      caps?.notes ? ['', '## 平台自记注（原文摘录）', '', `> ${String(caps.notes).replace(/\n/g, '\n> ')}`].join('\n') : '',
    ].join('\n'), [capsRel, `${p}/bridge.json`]);
    overview.push({ p, attestedAt: caps?.attestedAt || '—', passed: passed.length, absent: absent.length, unver: unver.length, hasPlatformDoc });
  }
  indexPage('platforms', '平台状态总表', overview.map((o) => ({
    id: o.p,
    version: o.attestedAt,
    versions: [],
    sumsCount: o.passed,
    registry: { enabled: o.hasPlatformDoc, invocable: o.absent === 0, kind: `declaredAbsent ${o.absent} / unverified ${o.unver}` },
  })), { sources: ['<platform>/bridge/capabilities.json', '<platform>/bridge.json'] });
  built.platforms = overview;
  built.counts.platforms = overview.length;
}

// 参考目录首页
{
  const rows = Object.entries(built.counts).filter(([k]) => !k.startsWith('contract-')).map(([k, v]) => [`[打开](/reference/${k})`, GENERATED_SECTIONS[k]?.label || k, v]);
  writeText(path.join(OUT, 'meta', '_category_.json'), JSON.stringify({ label: '关于本目录', position: 9, collapsible: true }, null, 1) + '\n');
  page('meta/index.md', {
    id: 'ref-index',
    title: '参考目录（自动生成）',
    sidebar_label: '参考目录说明',
    sidebar_position: 1,
    slug: REF_BASE,
    description: '三仓注册表与平台能力读数的自动复算页，不手工抄版本号',
  }, [
    '# 参考目录（自动生成）',
    '',
    '这里的每一张表和每一个版本号都是构建时从注册表复算出来的，**没有一个数字是手抄的**。',
    '',
    tbl(['目录', '栏目', '条目数'], rows),
    '',
    '## 读法与边界',
    '',
    '- **发布 ≠ 采纳**：这里显示的是已发布的当前指针（`current.json`），不代表任何平台已经用它跑过。',
    '- **结论不互抄**：平台页只读那个平台自己的 `bridge/capabilities.json`。',
    '- **完整性**：`SHA256SUMS 行数`＝该版本目录被清单覆盖的文件数；哈希内容不复制进本页。',
    '- 与原文不一致时以注册表与 `SHA256SUMS` 为准，并跑 `node scripts/docs-conform.mjs` 看差在哪。',
  ].join('\n'), ['tool/registry.json', 'agent/registry.json', 'software/registry.json', '<platform>/bridge/capabilities.json']);
}

function listAbs(v) {
  if (!v) return [];
  const arr = Array.isArray(v)
    ? v
    : Object.entries(v || {}).map(([k, val]) => ({ name: k, ...(val && typeof val === 'object' ? val : { reason: val }) }));
  return arr.filter(Boolean).map((x) => ({
    name: x.name || x.id || x.check || x.capability || JSON.stringify(x),
    path: x.path || x.route || x.plan || x.gapPlan || '',
    cost: x.costMinutes ?? x.cost ?? '',
    reason: x.reason || x.note || '',
  }));
}

function softwareExtra(it) {
  const m = it.manifest || {};
  const parts = [];
  if (m.software || m.binaries || m.executables) {
    const bins = m.software?.binaries || m.binaries || m.executables || [];
    parts.push('## 可执行文件', '', Array.isArray(bins) && bins.length ? bins.map((b) => `- ${typeof b === 'string' ? code(b) : code(b.name || b.id || JSON.stringify(b))}`).join('\n') : '（配方未声明）');
  }
  const snap = readIfJson(path.join(AI_ROOT, it.versionDirRel || '', 'capabilities.snapshot.json'));
  if (snap) {
    parts.push('## 能力快照（冻结状态）', '', tbl(['字段', '值'], [
      ['frozen', String(snap.frozen ?? '—')],
      ['snapshotAt', snap.at || snap.snapshotAt || '—'],
      ['来源', snap.source || snap.provenance || '—'],
      ['能力条目', Array.isArray(snap.capabilities) ? snap.capabilities.length : '—'],
    ]));
    if (Array.isArray(snap.capabilities) && snap.capabilities.length) {
      parts.push('', tbl(['能力', '状态/说明'], snap.capabilities.slice(0, 60).map((c) => [c.name || c.id || '—', c.status || c.value || c.note || '—'])));
    }
  }
  return parts.join('\n');
}

function softwareIndexNote(list) {
  const frozen = list.filter((x) => readIfJson(path.join(AI_ROOT, x.versionDirRel || '', 'capabilities.snapshot.json'))?.frozen === true).length;
  return `其中 **${frozen} / ${list.length}** 份配方的能力快照为 ` + '`frozen:true`' + '；未冻结的配方在引擎侧会以 `CAPABILITY_UNAVAILABLE` 回答，不是 `SOFTWARE_DRIFT`。';
}

const genDigest = shortHash(sha256Text(JSON.stringify(built)));
writeText(path.join(SITE_DIR, 'data', 'generated-report.json'), JSON.stringify({
  schema: 'ai-docs-generated/v1',
  generatedAt: nowStamp(),
  profile,
  digest: genDigest,
  ...built,
}, null, 2) + '\n');

const total = Object.keys(built.counts).length;
console.log(`[generate-reference] 生成目录 ${total} 类：workflows ${built.counts.workflows} / agents ${built.counts.agents} / software ${built.counts.software} / platforms ${built.counts.platforms} / contracts 当前 ${built.repos.contracts?.[0]?.version}`);
console.log(`[generate-reference] 摘要 digest=${genDigest} → data/generated-report.json`);
