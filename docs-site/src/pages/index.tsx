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

const CARDS = [
  {
    kicker: '快速开始',
    to: '/docs/quick-start/site-intro',
    title: '文档站说明',
    desc: '本站是生成物：事实来源在 E:\\ai 原文与三仓注册表，HTML 不可反向编辑。',
  },
  {
    kicker: '上位原则',
    to: '/docs/architecture/basic-principles',
    title: '架构基本原则 BP-1 ~ BP-7',
    desc: '三仓骨架不可变、平台对等、验收最小量、跨平台同语义、分步实施、入库先行、不可入库件备份。',
  },
  {
    kicker: '当前基线',
    to: '/docs/architecture/3.0.0',
    title: '架构 3.0.0',
    desc: 'software 成为同构的第三共享仓，引擎新增 software-call 动作；判据在 3.0.0 定稿实施表。',
  },
  {
    kicker: '共享资源',
    to: '/reference/workflows',
    title: '工作流 / 专家 / 软件配方目录',
    desc: '版本号、可用版本数与完整性清单行数全部由脚本从 registry 与 current.json 复算。',
  },
  {
    kicker: '运行契约',
    to: '/docs/runtime/orientation',
    title: 'run-lock、版本解析、交接包与仲裁',
    desc: '把散在多份治理文本里的运行不变量串成一页，并指向自动生成的契约页。',
  },
  {
    kicker: '平台自证',
    to: '/reference/platforms',
    title: '各平台能力读数',
    desc: '每个平台只读它自己的 bridge/capabilities.json；结论不互抄，缺口带补齐路径。',
  },
  {
    kicker: '变更与历史',
    to: '/docs/history/timeline',
    title: '演进时间线与提案',
    desc: '1.0.0 → 2.0.0 → 2.0.x → 2.1-A → 3.0-A / 3.0-Q，以及未定稿的 3.1.0 提案。',
  },
  {
    kicker: '台账',
    to: '/docs/architecture/platform-checklist',
    title: '平台接入清单',
    desc: '逐轮增量的总账（§8.x）；平台状态的现行台账载体。',
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
          <h1>E:\ai 架构与治理文档站</h1>
          <p className="lede">
            把这套「三共享仓 + 多运行平台」的治理体系装成一个可检索的静态站：
            精选白名单原文 + 注册表自动生成的参考目录 + 一条 <code>docs-conform</code> 验收命令。
            中文是事实版本，页面状态一律带徽章——当前基线、历史基线、提案、冻结历史不会混在一起。
          </p>
          <div className="eai-facts">
            {facts.map((f) => (
              <div className="eai-fact" key={f.t}>
                <b>{f.n}</b>
                <span>{f.t}</span>
              </div>
            ))}
          </div>
          <div>
            <a className="button button--primary button--lg margin-right--sm" href="/docs/quick-start/overview">
              从「当前架构概览」开始
            </a>
            <a className="button button--outline button--lg" href="/reference">
              看自动生成的目录
            </a>
          </div>
        </div>
      </header>
      <main className="container margin-top--lg margin-bottom--xl">
        <h2>按栏目进</h2>
        <div className="eai-cards">
          {CARDS.map((c) => (
            <a className="eai-card" href={c.to} key={c.to}>
              <span className="kicker">{c.kicker}</span>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </a>
          ))}
        </div>
        <h2>三句话口径</h2>
        <ul>
          <li><b>发布 ≠ 采纳</b>：目录里的版本号是「已发布的当前指针」，不代表任何平台已经用它跑过。</li>
          <li><b>结论不互抄</b>：平台能力读数只来自该平台自己的证据文件，一个平台不为另一个平台申报。</li>
          <li><b>原文优先</b>：本页任何内容与 <code>E:\ai</code> 原文不一致时，以原文与注册表为准，重跑构建即可。</li>
        </ul>
      </main>
    </Layout>
  );
}
