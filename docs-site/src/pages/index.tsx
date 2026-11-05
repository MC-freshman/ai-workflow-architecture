import React from 'react';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

// 构建期摘要（由 scripts/sync-docs.mjs 与 scripts/generate-reference.mjs 产出）。
// 首页只显示复算出来的数字，不手填计数；静态 import 让 webpack 能把 JSON 打进产物。
import lockJson from '../../data/source-lock.json';
import genJson from '../../data/generated-report.json';
import invJson from '../../data/inventory.json';

const lock: any = lockJson as any;
const gen: any = genJson as any;
const inventory: any = invJson as any;

const CARD_GROUPS = [
  {
    title: '先读什么',
    note: '第一次来，按这个顺序走。',
    cards: [
      {
        kicker: '从零开始',
        to: '/docs/quick-start/site-intro',
        title: '文档站说明',
        desc: '本站是生成物：事实来源在 E:\\ai 原文与三仓注册表，HTML 不可反向编辑。',
      },
      {
        kicker: '全貌',
        to: '/docs/quick-start/overview',
        title: '当前架构概览',
        desc: '三仓骨架、七个平台目录与当前入口；版本号以自动生成目录页为准。',
      },
      {
        kicker: '操作',
        to: '/docs/quick-start/manager-operations',
        title: '管理台操作手册',
        desc: '0.7.0 历史版操作说明；现行管理台 0.9.0 的增量以根仓 README 与更新日志为准。',
      },
      {
        kicker: '排错',
        to: '/docs/quick-start/manager-errors',
        title: '报错排查与恢复',
        desc: '按症状找处理步骤，搜索 187 个界面错误码；原生待适配和用户可修问题分别说明。',
      },
    ],
  },
  {
    title: '架构与运行',
    note: '要判断“现在按什么规则做”，从这里进。',
    cards: [
      {
        kicker: '上位原则',
        to: '/docs/architecture/basic-principles',
        title: '架构基本原则 BP-1 ~ BP-7',
        desc: '三仓骨架、平台对等、验收最小量、跨平台同语义、分步实施、入库先行、不可入库件备份。',
      },
      {
        kicker: '最新命名基线',
        to: '/docs/architecture/3.7.0',
        title: '架构 3.7.0',
        desc: '管理台自动接入基线；管理台 0.8.14 的增量见更新日志。3.0.0 作为三仓基线保留。',
      },
      {
        kicker: '运行契约',
        to: '/docs/runtime/orientation',
        title: 'run-lock、版本解析与交接包',
        desc: '把散在多份治理文本里的运行不变量串成一页；含 BP-4 两项续跑机制与平台内锁表边界。',
      },
      {
        kicker: '平台台账',
        to: '/docs/architecture/platform-checklist',
        title: '平台接入清单',
        desc: '逐轮增量的总账（§8.x）；平台状态的现行台账载体。',
      },
    ],
  },
  {
    title: '共享资源',
    note: '版本号、可用版本与完整性清单全部由脚本从注册表复算。',
    cards: [
      {
        kicker: '三仓目录',
        to: '/reference/workflows',
        title: '工作流 / 专家 / 软件配方',
        desc: '从 registry 与 current.json 自动生成；发布 ≠ 采纳，平台钉版另看状态页。',
      },
      {
        kicker: '平台自证',
        to: '/reference/platforms',
        title: '各平台能力读数',
        desc: '每个平台只读它自己的 bridge/capabilities.json；结论不互抄，缺口带补齐路径。',
      },
    ],
  },
  {
    title: '变更与历史',
    note: '想追一条规则何时定下、为何变更，从这里查。',
    cards: [
      {
        kicker: '时间线',
        to: '/docs/history/timeline',
        title: '架构演进时间线',
        desc: '1.0.0 → 2.0.0 → 3.0.0 → 3.7.0，以及历史提案与开放事项。',
      },
      {
        kicker: '待办',
        to: '/docs/history/open-items',
        title: '当前开放事项',
        desc: '平台接入、D-174–D-177、跨平台仲裁裁减与本站自身开放项。',
      },
    ],
  },
];

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  const facts = [
    { n: lock?.counts?.entries ?? '—', t: '已发布页面（本档位）' },
    { n: gen?.counts?.workflows ?? '—', t: '工作流条目' },
    { n: gen?.counts?.agents ?? '—', t: '专家条目' },
    { n: gen?.counts?.software ?? '—', t: '软件配方' },
    { n: gen?.platforms?.length ?? '—', t: '平台状态页' },
    { n: inventory?.totals?.markdownCandidates ?? '—', t: '盘上 Markdown 候选' },
  ];

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <header className="hero hero--eai">
        <div className="container">
          <p className="hero-kicker">E:\ai · 架构与治理阅读入口</p>
          <h1>把复杂的架构，读成一页一页的书。</h1>
          <p className="lede">
            三共享仓、七个平台目录、一套可复算的治理文本。精选原文按主题分组，
            自动生成的目录给出当前版本；中文是事实版本，页面状态用徽章区分，
            当前基线、历史基线与提案不会混在一起。
          </p>
          <p className="hero-search-hint">
            按 <kbd>Ctrl</kbd> + <kbd>K</kbd> 搜索全站，或从下面四组入口开始。
          </p>
          <div className="eai-facts">
            {facts.map((f) => (
              <div className="eai-fact" key={f.t}>
                <b>{f.n}</b>
                <span>{f.t}</span>
              </div>
            ))}
          </div>
          <div className="hero-actions">
            <a className="button button--primary button--lg margin-right--sm" href="/docs/quick-start/site-intro">
              从文档站说明开始
            </a>
            <a className="button button--outline button--lg" href="/reference">
              查看共享资源目录
            </a>
          </div>
        </div>
      </header>
      <main className="container margin-top--lg margin-bottom--xl home-main">
        {CARD_GROUPS.map((group) => (
          <section className="home-group" key={group.title}>
            <div className="home-group-head">
              <h2>{group.title}</h2>
              <p>{group.note}</p>
            </div>
            <div className="eai-card-grid">
              {group.cards.map((c) => (
                <a className="eai-card" href={c.to} key={c.to}>
                  <span className="kicker">{c.kicker}</span>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                </a>
              ))}
            </div>
          </section>
        ))}
        <section className="home-reading-note">
          <h2>三句话口径</h2>
          <ul>
            <li><b>发布 ≠ 采纳</b>：目录里的版本号是「已发布的当前指针」，不代表任何平台已经用它跑过。</li>
            <li><b>结论不互抄</b>：平台能力读数只来自该平台自己的证据文件，一个平台不为另一个平台申报。</li>
            <li><b>原文优先</b>：本页任何内容与 <code>E:\ai</code> 原文不一致时，以原文与注册表为准，重跑构建即可。</li>
          </ul>
        </section>
      </main>
    </Layout>
  );
}
