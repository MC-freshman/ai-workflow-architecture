// Generates src/app/module-registry.json — a DERIVED view, never hand-edit.
// Sources: app/operations.json (channels), src/domains/* (exports), renderer panels/views.
// Replacement metadata comes from the approved P-table matrix (versions/架构与管理台模块化更新P表-20261111.md §4).
// Usage: node scripts/generate-module-registry.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// M01–M23 replacement matrix (approved 2026-11-11). Options are declarations, not authorizations.
const MATRIX = {
  M01: { replaceable: true, contract: '注册表驱动 + 契约测试（同 fixture 渲染一致）', self: '配置驱动注册表 + 按视图懒加载（P3）', soft: 'single-spa / 模块联邦：不可行（CSP connect-src none 禁远程加载）', impact: '全部 22 面板与 12 视图' },
  M02: { replaceable: true, contract: 'operations.json 单一声明源 + 三方一致边界测试', self: '注册表派生校验（P2），声明源不变', soft: 'electron-trpc：不推荐（重写 116 通道模型）', impact: '116 IPC 通道、preload、register' },
  M03: { replaceable: true, contract: '11 步口径与 readAdoptionCompletion 语义不变', self: '契约不变、实现可重写', soft: '无等价外部软件（厂商专有）', impact: '7 平台入驻流水线' },
  M04: { replaceable: true, contract: '三层状态签口径不变', self: '契约不变、实现可重写', soft: '无等价', impact: '平台检查、一键更新、原生回执' },
  M05: { replaceable: true, contract: '发布计划语义与只读旧版约束不变', self: '手动 CLI 发布（release_tool 路径）可作降级', soft: '无等价', impact: '三仓资源导入发布' },
  M06: { replaceable: true, contract: 'ai-software/v1 配方契约不变', self: '简化直读配方', soft: 'MCP 直连（09-22 登记方向，D-60 落差另案）', impact: '软件接入、健康、恢复' },
  M07: { replaceable: true, contract: 'registry/contracts 读面结构不变', self: '直读三仓 registry（已如此）', soft: '无必要', impact: '三仓盘点' },
  M08: { replaceable: true, contract: '锚定代与对齐判据不变', self: '共享 platform-conformance 判据（已接）', soft: '同左', impact: '认证矩阵' },
  M09: { replaceable: true, contract: 'git 计划/敏感扫描/事务语义不变', self: '保持自写计划层', soft: 'isomorphic-git（Windows 凭据/GPG/性能局限）或 simple-git', impact: 'commit/push/备份计划' },
  M10: { replaceable: true, contract: 'events.jsonl 封条与完整性口径不变', self: '保持自写', soft: 'SQLite/sql.js（引依赖、迁移成本）', impact: '审计与缺陷读面' },
  M11: { replaceable: true, contract: 'planKinds 路由语义不变', self: '可重写', soft: '无等价', impact: '计划中心' },
  M12: { replaceable: true, contract: '文档读写与源锁联动不变', self: '可重写', soft: '无等价', impact: '治理文档读写' },
  M13: { replaceable: true, contract: '同 fixture run 目录 → 输出逐字可比一致（P4 试点）', self: '最小自写替代实现（P4 试点）', soft: '无外部等价（数据专有）', impact: 'runs 视图' },
  M14: { replaceable: true, contract: '克隆校验与首扫语义不变', self: '可重写', soft: '无等价', impact: '工作区引导' },
  M15: { replaceable: false, contract: null, self: '不推荐替换（恢复语义是安全核心）', soft: '无等价', impact: '全部写路径' },
  M16: { replaceable: true, contract: '哈希/路径输出逐字节一致', self: '保持 node:crypto', soft: '外部 sha256sum（无必要）', impact: '全局' },
  M17: { replaceable: true, contract: '探针回执结构不变', self: '部分探针 Node 化（逐项评估，另案）', soft: '保持 Python（BP-1 §1.6③ 平台 runtime）', impact: '环境与能力探针' },
  M18: { replaceable: true, contract: 'conform 五段与 digest 语义不变', self: '共享 architecture-ops/platform-conformance（已接）', soft: '同左', impact: '门禁 digest' },
  M19: { replaceable: false, contract: null, self: '—', soft: 'Tauri：本轮不可行（整体重写）；electron-forge 收益低', impact: '双包发行' },
  M20: { replaceable: true, contract: 'MCP 工具面与确认写语义不变', self: '保持自包含 stdio（零依赖硬优点）', soft: '@modelcontextprotocol/sdk（钉版；配方安装需 npm 依赖）', impact: 'AI 入口' },
  M21: { replaceable: true, contract: 'C1–C11 源锁门禁不变', self: '自写 SSG（不推荐）', soft: 'VitePress/Astro：高成本（门禁重写）', impact: '文档站双档门禁' },
  M22: { replaceable: true, contract: 'schema 校验结论一致', self: '自写校验器（不推荐）', soft: '保持 ajv；fast-uri 漏洞经升级 ajv 修（另决）', impact: '契约校验' },
  M23: { replaceable: true, contract: '缺陷簿 check.py 判据不变', self: '保持 JSON', soft: 'SQLite（治理判据重写）', impact: '治理机检' }
};

const DOMAIN_MATRIX = { onboarding: 'M03', platforms: 'M04', intake: 'M05', software: 'M06', resources: 'M07', certification: 'M08', git: 'M09', audit: 'M10', plans: 'M11', docs: 'M12', runs: 'M13', workspace: 'M14' };
const CHANNEL_PREFIX_MODULE = {
  intake: 'domain-intake', plan: 'domain-plans', software: 'domain-software', ui: 'mech-app',
  workspace: 'domain-workspace', platform: 'domain-platforms', anchor: 'domain-certification',
  catalog: 'domain-resources', skill: 'domain-resources', document: 'domain-docs', git: 'domain-git',
  integration: 'domain-platforms', runs: 'domain-runs', defects: 'domain-audit', inbox: 'domain-intake',
  audit: 'domain-audit', releases: 'domain-intake', plans: 'domain-plans', docs: 'domain-docs',
  onboarding: 'domain-onboarding', transaction: 'mech-transactions', task: 'mech-app',
  'native-mcp': 'domain-platforms', 'global-update': 'domain-platforms', gate: 'domain-audit'
};

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function walkMjs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMjs(fp));
    else if (e.name.endsWith('.mjs')) out.push(fp);
  }
  return out;
}
function parseExports(rel) {
  const names = [];
  read(rel).split('\n').forEach((line) => {
    let m = line.match(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/);
    if (m) names.push(m[1]);
    m = line.match(/^export\s*\{([^}]+)\}/);
    if (m) for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  });
  return [...new Set(names)].sort();
}
function loadViewDefinitions() {
  const defs = JSON.parse(read('src/app/view-definitions.json'));
  if (defs.schema !== 'ai-manager-views/v1' || !Array.isArray(defs.views) || defs.views.length === 0) {
    throw Error('MODULE_REGISTRY_VIEW_DEFINITIONS_INVALID');
  }
  return defs.views;
}
const panelId = (file) => 'panel-' + path.basename(file).replace(/\.jsx$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
// Feature-level panels not living in src/renderer/panels/ (composed via lazy loaders).
const FEATURE_PANELS = ['src/renderer/features/intake/BodyIntakePanel.jsx'];

function moduleEntry(id, kind, entry, matrixRef, extra = {}) {
  const meta = MATRIX[matrixRef];
  return {
    id, kind, entry,
    ...(extra.files ? { files: extra.files } : {}),
    ...(extra.exports && extra.exports.length ? { exports: extra.exports } : {}),
    ...(extra.channels && extra.channels.length ? { channels: extra.channels } : {}),
    ...(extra.dependsOn && extra.dependsOn.length ? { dependsOn: extra.dependsOn } : {}),
    replaceable: meta.replaceable,
    replacementContract: meta.contract,
    replacementOptions: { selfWritten: meta.self, softwareIntegration: meta.soft },
    impactScope: meta.impact,
    healthCheck: extra.healthCheck ?? 'test/module-registry.test.mjs',
    matrixRef,
    enabled: true,
    replacement: null
  };
}

export function generateRegistry() {
  const ops = JSON.parse(read('src/app/operations.json'));
  const channels = Object.values(ops.operations).map((o) => o.channel).sort();
  const channelsByModule = {};
  for (const ch of channels) {
    const prefix = ch.split(':')[0];
    const target = CHANNEL_PREFIX_MODULE[prefix];
    if (!target) throw Error('MODULE_REGISTRY_CHANNEL_UNMAPPED:' + ch);
    (channelsByModule[target] ||= []).push(ch);
  }
  const viewDefs = loadViewDefinitions();
  const modules = [];

  for (const domain of Object.keys(DOMAIN_MATRIX).sort()) {
    const files = walkMjs(path.join(ROOT, 'src/domains', domain)).map((f) => path.relative(ROOT, f).replaceAll('\\', '/'));
    const exports = [...new Set(files.flatMap((f) => parseExports(f)))].sort();
    modules.push(moduleEntry('domain-' + domain, 'domain', 'src/domains/' + domain + '/', DOMAIN_MATRIX[domain], {
      files, exports, channels: channelsByModule['domain-' + domain] || [], dependsOn: ['mech-core']
    }));
  }
  const panelFiles = fs.readdirSync(path.join(ROOT, 'src/renderer/panels')).filter((f) => f.endsWith('.jsx')).sort().map((f) => 'src/renderer/panels/' + f);
  const allPanels = [...panelFiles, ...FEATURE_PANELS];
  const panelIds = new Set(allPanels.map((rel) => panelId(rel)));
  for (const rel of allPanels) {
    const id = panelId(rel);
    modules.push(moduleEntry(id, 'panel', rel, id === 'panel-runs' ? 'M13' : 'M01', { exports: parseExports(rel) }));
  }
  const views = viewDefs.map((v, order) => {
    for (const p of v.panels) {
      if (!panelIds.has(p)) throw Error('MODULE_REGISTRY_VIEW_PANEL_UNKNOWN:' + v.id + ':' + p);
    }
    if (v.sections) {
      const flat = v.sections.flatMap((s) => s.panels);
      if (JSON.stringify(flat) !== JSON.stringify(v.panels)) throw Error('MODULE_REGISTRY_VIEW_SECTIONS_MISMATCH:' + v.id);
    }
    modules.push(moduleEntry('view-' + v.id, 'view', 'src/app/view-definitions.json', 'M01', { dependsOn: v.panels }));
    return { id: v.id, label: v.label, group: v.group, description: v.description || '', panels: v.panels, order, ...(v.sections ? { sections: v.sections } : {}) };
  });
  const runtimeFiles = fs.readdirSync(path.join(ROOT, 'src/runtime')).filter((f) => f.endsWith('.py')).sort().map((f) => 'src/runtime/' + f);
  modules.push(moduleEntry('runtime-probes', 'runtime', 'src/runtime/', 'M17', { files: runtimeFiles, dependsOn: ['mech-core'] }));
  for (const s of fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).sort()) {
    modules.push(moduleEntry('gate-' + s.replace(/\.mjs$/, ''), 'gate', 'scripts/' + s, 'M18'));
  }
  modules.push(moduleEntry('entry-main', 'entry', 'src/main.mjs', 'M01'));
  modules.push(moduleEntry('entry-cli', 'entry', 'src/cli.mjs', 'M18'));
  modules.push(moduleEntry('entry-preload', 'entry', 'src/preload.cjs', 'M02'));
  modules.push(moduleEntry('mech-core', 'mechanism', 'src/core/', 'M16'));
  modules.push(moduleEntry('mech-infrastructure', 'mechanism', 'src/infrastructure/', 'M15'));
  modules.push(moduleEntry('mech-transactions', 'mechanism', 'src/transactions/', 'M15', { channels: channelsByModule['mech-transactions'] || [] }));
  modules.push(moduleEntry('mech-app', 'mechanism', 'src/app/', 'M02', { channels: channelsByModule['mech-app'] || [] }));
  // Configuration surfaces (M19/M22) and external governance/product surfaces (M20/M21/M23).
  // External entries are workspace-root-relative; they are referenced by the matrix, not owned by manager src.
  modules.push(moduleEntry('packaging-config', 'mechanism', 'package.json', 'M19'));
  modules.push(moduleEntry('schema-validation-dep', 'mechanism', 'package.json', 'M22'));
  modules.push(moduleEntry('mcp-recipe-surface', 'external', 'software/architecture-manager-mcp/', 'M20', { healthCheck: null }));
  modules.push(moduleEntry('docs-site-surface', 'external', 'docs-site/', 'M21', { healthCheck: null }));
  modules.push(moduleEntry('defect-book-surface', 'external', 'versions/缺陷状态簿.json', 'M23', { healthCheck: null }));
  // entry-preload is a generated artifact: not independently replaceable.
  const preload = modules.find((m) => m.id === 'entry-preload');
  preload.replaceable = false; preload.replacementContract = null;
  // Declarative detach/replace switches (P4). Registry stays a derived view.
  const overrides = JSON.parse(read('src/app/module-overrides.json'));
  if (overrides.schema !== 'ai-manager-module-overrides/v1' || !overrides.overrides || typeof overrides.overrides !== 'object' || Array.isArray(overrides.overrides)) {
    throw Error('MODULE_OVERRIDES_INVALID');
  }
  for (const [id, ov] of Object.entries(overrides.overrides)) {
    const target = modules.find((m) => m.id === id);
    if (!target) throw Error('MODULE_OVERRIDE_UNKNOWN:' + id);
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) throw Error('MODULE_OVERRIDE_INVALID:' + id);
    if (ov.enabled !== undefined) {
      if (typeof ov.enabled !== 'boolean') throw Error('MODULE_OVERRIDE_ENABLED_INVALID:' + id);
      target.enabled = ov.enabled;
    }
    if (ov.replacement !== undefined) {
      if (ov.replacement !== null && typeof ov.replacement !== 'string') throw Error('MODULE_OVERRIDE_REPLACEMENT_INVALID:' + id);
      target.replacement = ov.replacement;
    }
  }
  modules.sort((a, b) => a.id.localeCompare(b.id));
  return {
    schema: 'ai-manager-module/v1',
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      operations: 'src/app/operations.json',
      domains: 'src/domains/',
      panels: 'src/renderer/panels/',
      views: 'src/app/view-definitions.json'
    },
    summary: {
      moduleCount: modules.length,
      domainCount: Object.keys(DOMAIN_MATRIX).length,
      panelCount: allPanels.length,
      viewCount: views.length,
      channelCount: channels.length
    },
    modules,
    views
  };
}

export function serialize(registry) { return JSON.stringify(registry, null, 2) + '\n'; }
export function withoutTimestamp(registry) { const { generatedAt, ...rest } = registry; return rest; }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const output = path.join(ROOT, 'src/app/module-registry.json');
  const registry = generateRegistry();
  if (process.argv.includes('--check')) {
    const committed = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (JSON.stringify(withoutTimestamp(committed)) !== JSON.stringify(withoutTimestamp(registry))) {
      throw Error('MODULE_REGISTRY_DRIFT');
    }
    console.log('module-registry fresh:', registry.summary.moduleCount, 'modules /', registry.summary.channelCount, 'channels');
  } else {
    fs.writeFileSync(output, serialize(registry));
    console.log('module-registry written:', registry.summary.moduleCount, 'modules /', registry.summary.channelCount, 'channels');
  }
}