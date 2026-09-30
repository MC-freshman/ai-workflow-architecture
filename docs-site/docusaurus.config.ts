// @ts-check
// E:\ai 架构文档站 —— Docusaurus 3.10 配置
// 事实来源永远是 E:\ai 原文与三仓注册表；本文件只管呈现与路由。
import { themes as prismThemes } from 'prism-react-renderer';
// 中文正文里 `**粗体**，` 这种收尾按 CommonMark 的 flanking 规则不成立，会让星号原样露出
import remarkCjkFriendly from 'remark-cjk-friendly';
import path from 'node:path';
import fs from 'node:fs';

// Docusaurus 始终以站点目录为 cwd 运行；这里不用 import.meta.url（TS 配置经 jiti 转译时不可靠）
const SITE_DIR = process.cwd();
const readJson = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SITE_DIR, rel), 'utf8'));
  } catch {
    return null;
  }
};

const PROFILE = process.env.DOCS_PROFILE === 'shareable' ? 'shareable' : 'internal';
const BASE_URL = process.env.BASE_URL || '/';
const manifest = readJson('data/docs-manifest.json');
const included = manifest?.entries?.filter((e) => (PROFILE === 'shareable' ? e.visibility === 'public' : true)) || [];

// shareable 档：只保留能落到已收录页面的导航项，避免把内部页拉进对外产物
const PUBLIC_SLUGS = new Set((manifest?.entries || []).filter((e) => e.visibility === 'public').map((e) => e.slug));
const REF_SHAREABLE_DIRS = ['', 'workflows', 'packs', 'governance', 'agents', 'software', 'contracts', 'skills', 'meta'];
function routeOk(to) {
  if (PROFILE !== 'shareable') return true;
  const t = String(to).replace(/\/+$/, '') || '/';
  if (t === '/') return true;
  if (t.startsWith('/reference')) return REF_SHAREABLE_DIRS.includes(t.split('/')[2] || '');
  if (t.startsWith('/docs')) return PUBLIC_SLUGS.has(t);
  return true;
}

const NAVBAR_ITEMS = [
  { type: 'doc', docId: 'quick-start/site-intro', position: 'left', label: '文档' },
  { to: '/reference', label: '共享资源（自动生成）', position: 'left' },
  { to: '/docs/architecture/basic-principles', label: '基本原则 BP-1~7', position: 'left' },
  { to: '/docs/architecture/3.0.0', label: '当前基线 3.0.0', position: 'left' },
  { to: '/docs/history/timeline', label: '演进时间线', position: 'left' },
  { to: '/docs/quick-start/site-intro', label: '关于本站', position: 'right' },
].filter((it) => !it.to || routeOk(it.to));

const FOOTER_LINKS = [
  {
    title: '治理',
    items: [
      { label: '架构基本原则', to: '/docs/architecture/basic-principles' },
      { label: '架构 3.0.0（当前基线）', to: '/docs/architecture/3.0.0' },
      { label: '平台接入清单', to: '/docs/architecture/platform-checklist' },
    ],
  },
  {
    title: '共享资源',
    items: [
      { label: '工作流目录', to: '/reference/workflows' },
      { label: '专家目录', to: '/reference/agents' },
      { label: '软件配方目录', to: '/reference/software' },
      { label: '平台状态', to: '/reference/platforms' },
    ],
  },
  {
    title: '怎么用这站',
    items: [
      { label: '文档站说明', to: '/docs/quick-start/site-intro' },
      { label: '当前架构概览', to: '/docs/quick-start/overview' },
      { label: '参考目录说明', to: '/reference' },
    ],
  },
]
  .map((col) => ({ ...col, items: col.items.filter((it) => routeOk(it.to)) }))
  .filter((col) => col.items.length);

const config = {
  title: 'E:\\ai 架构文档站',
  tagline: '三仓骨架 · 七条基本原则 · 平台各自出证 —— 治理文本与注册表读数的静态站点',
  url: 'https://example.invalid',
  baseUrl: BASE_URL,
  favicon: 'img/favicon.svg',
  trailingSlash: false,
  organizationName: 'E-ai',
  projectName: 'docs-site',

  i18n: {
    // 中文是事实版本；英文不自动翻译，避免语义漂移（补翻译时把 'en' 加进 locales 并跑 write-translations）
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
    localeConfigs: {
      'zh-Hans': { label: '中文（简体）', htmlLang: 'zh-CN' },
    },
  },

  onBrokenLinks: PROFILE === 'internal' ? 'warn' : 'throw',
  onDuplicateRoutes: 'warn',

  markdown: {
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['en', 'zh'],
        docsRouteBasePath: ['/docs', '/reference'],
        indexBlog: false,
        indexDocs: true,
        searchResultLimits: 12,
        highlightSearchTermsOnTargetPage: false,
      },
    ],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        // 主文档面显式注册成 plugin-content-docs（preset 的 docs 选项不接受 sidebarId）
        docs: false,
        blog: false,
        pages: {
          path: 'src/pages',
          routeBasePath: '/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      ({
        id: 'default',
        path: 'docs',
        routeBasePath: '/docs',
        showLastUpdateTime: false,
        showLastUpdateAuthor: false,
        remarkPlugins: [remarkCjkFriendly],
      }),
    ],
    [
      '@docusaurus/plugin-content-docs',
      /** @type {import('@docusaurus/plugin-content-docs').Options} */
      ({
        id: 'reference',
        path: 'generated',
        routeBasePath: '/reference',
        showLastUpdateTime: false,
        remarkPlugins: [remarkCjkFriendly],
      }),
    ],
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: (readJson('data/redirects.json')?.redirects || []).map((r) => ({ from: r.from, to: r.to })),
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social.svg',
      navbar: {
        title: '架构文档站',
        logo: { alt: 'E:\\ai', src: 'img/logo.svg' },
        items: NAVBAR_ITEMS,
      },
      footer: {
        style: 'dark',
        logo: { src: 'img/logo.svg', alt: 'E:\\ai' },
        copyright: `构建档位：${PROFILE} · 内容事实来源为 E:\\ai 原文与三仓注册表 · 本页由 docs-site 构建脚本生成，HTML 不是可编辑源`,
        links: FOOTER_LINKS,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        defaultLanguage: 'yaml',
      },
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      docs: { sidebar: { autoCollapseCategories: false, hideable: true } },
    }),
};

export default config;
