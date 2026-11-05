import {GlobalUpdatePanel} from '../../panels/global-update.jsx';
import {TaskProgress} from '../../shared/TaskProgress.jsx';
import {BodyIntakePanel} from '../../features/intake/BodyIntakePanel.jsx';
import React, { useEffect, useState } from 'react';
import {
  AnchorPanel,
  AuditPanel,
  CatalogPanel,
  ClonePanel,
  DashboardStats,
  DocumentPanel,
  GitPanel,
  GovernancePanel,
  HelpPanel,
  HomePulse,
  InboxPanel,
  IntegrationPanel,
  OnboardPanel,
  PlanCenterPanel,
  PlanPreview,
  PlatformPanel,
  ReleasePanel,
  ResourcePanel,
  RunsPanel,
  SafetyPanel,
  SoftwarePanel
} from '../../components.jsx';
import { friendlyError, PLAN_WRITE_KINDS } from '../../presenter.mjs';


const NAV_GROUPS = [
  { label: '总览', ids: ['dashboard'] },
  { label: '资源与软件', ids: ['resources', 'intake', 'software'] },
  { label: '平台', ids: ['platform'] },
  { label: '运行与治理', ids: ['runs', 'governance', 'audit', 'inbox'] },
  { label: '文档与仓库', ids: ['documents', 'git'] },
  { label: '帮助', ids: ['safety'] },
];

const VIEW_META = {
  dashboard: '工作区总览：平台、共享仓、文档、Git 与计划进度。',
  resources: '三仓资源、版本切换、发布与目录管理。',
  intake: '把平台、专家、技能、工作流或软件本体导入并登记。',
  platform: '平台接入、环境、provider、能力实测与版本对齐。',
  runs: '只读查看各平台 run 台账与终态。',
  governance: '缺陷状态簿、机检与治理登记。',
  documents: '更新日志、计划与说明文档的读取和编辑。',
  audit: '本机管理台审计历史与完整性检查。',
  inbox: 'backup / archive / trash 三区只读盘点。',
  software: '软件配方、连接器、健康检查与导入。',
  git: '提交、分支、标签、备份、快照与回滚计划。',
  safety: '安全边界与新手操作说明。',
};

export function WorkspaceScreen(model) {
  const {workspace,setWorkspace,workspaceSession,inventory,setInventory,busy,setBusy,message,setMessage,recordProgress,api,planPreview,setPlanPreview,planPayload,setPlanPayload,appVersion,setAppVersion,transactionProgress,setTransactionProgress,showExcluded,setShowExcluded,selectedDocument,setSelectedDocument,documentDraft,setDocumentDraft,sensitiveConfirmed,setSensitiveConfirmed,softwareResults,setSoftwareResults,gitDetails,setGitDetails,sensitiveScan,setSensitiveScan,catalogDetail,setCatalogDetail,catalogFilter,setCatalogFilter,documentFilter,setDocumentFilter,skillDetail,setSkillDetail,skillFilter,setSkillFilter,resourceFilter,setResourceFilter,targetVersions,setTargetVersions,integrationKind,setIntegrationKind,integrationTargetId,setIntegrationTargetId,integrationMode,setIntegrationMode,integrationPaths,setIntegrationPaths,integrationPath,setIntegrationPath,integrationTarget,setIntegrationTarget,integrationText,setIntegrationText,integrationTargetVersion,setIntegrationTargetVersion,platformSuggestion,setPlatformSuggestion,dark,setDark,view,setView,VIEWS,activeView,scan,refreshGit,gitState,resources,documentSummaries,visibleDocuments,software,agents,skills,integrationOptions,reloadIntegrationTarget,previewIntegration,previewPlatform,checkPlatform,addPlatformDirectory,openCatalog,previewRegistryAction,previewResource,openDocument,previewDocument,checkSoftware,previewSoftware,previewSoftwareImport,previewSoftwareRecipe,previewSoftwareLocation,previewSoftwareConnectorLaunch,previewSoftwareRevert,previewGit,executePlan,inspectAnchor,previewAnchor,previewAnchorAlignment,anchorReport,friendlyError,PLAN_WRITE_KINDS}=model;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        setPaletteQuery('');
        setPaletteIndex(0);
      }
      if (event.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setPaletteIndex(0); }, [paletteQuery, paletteOpen]);

  const paletteItems = VIEWS.map((item) => ({
    ...item,
    group: NAV_GROUPS.find((entry) => entry.ids.includes(item.id))?.label || '其他',
    description: VIEW_META[item.id] || ''
  }));
  const paletteFiltered = paletteItems.filter((item) =>
    `${item.label} ${item.group} ${item.description}`.toLowerCase().includes(paletteQuery.trim().toLowerCase())
  );
  const openView = (id) => {
    if (!workspace && id !== 'platform') return;
    setView(id);
    setPaletteOpen(false);
    setPaletteQuery('');
  };
  const onPaletteKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPaletteIndex((index) => Math.min(index + 1, Math.max(0, paletteFiltered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPaletteIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && paletteFiltered[paletteIndex]) {
      event.preventDefault();
      openView(paletteFiltered[paletteIndex].id);
    }
  };
  const activeMeta = VIEWS.find((item) => item.id === activeView) || VIEWS[0];

const renderView = (active) => {
    switch (active) {
      case 'dashboard': return <>
        <DashboardStats inventory={inventory} gitState={gitState} />
        <HomePulse api={api} workspace={workspace} />
        <PlanCenterPanel api={api} workspace={workspace} onOpenDocument={path=>{setView('documents');openDocument(path);}} />
      </>;
      case 'resources': return <>
        <ResourcePanel api={api} workspace={workspace} inventory={inventory} resources={resources} resourceFilter={resourceFilter} setResourceFilter={setResourceFilter} targetVersions={targetVersions} setTargetVersions={setTargetVersions} previewResource={previewResource} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} />
        <ReleasePanel api={api} workspace={workspace} inventory={inventory} resources={resources} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />
        <CatalogPanel api={api} workspace={workspace} inventory={inventory} catalogFilter={catalogFilter} setCatalogFilter={setCatalogFilter} agents={agents} skills={skills} skillFilter={skillFilter} setSkillFilter={setSkillFilter} catalogDetail={catalogDetail} setCatalogDetail={setCatalogDetail} skillDetail={skillDetail} setSkillDetail={setSkillDetail} openCatalog={openCatalog} previewRegistryAction={previewRegistryAction} friendlyError={friendlyError} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />
      </>;
      case 'intake': return <BodyIntakePanel key={workspaceSession} api={api} workspace={workspace} inventory={inventory} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />;
      case 'platform': return <>
        {!workspace && <ClonePanel api={api} onCloned={(root) => scan(root)} setMessage={setMessage} friendlyError={friendlyError} />}
        <GlobalUpdatePanel api={api} workspace={workspace} inventory={inventory} busy={busy} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} />
        <OnboardPanel api={api} workspace={workspace} inventory={inventory} busy={busy} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />
        <AnchorPanel api={api} workspace={workspace} report={anchorReport} inspectAnchor={inspectAnchor} previewAnchor={previewAnchor} previewAnchorAlignment={previewAnchorAlignment} busy={busy} />
        <PlatformPanel inventory={inventory} showExcluded={showExcluded} setShowExcluded={setShowExcluded} addPlatformDirectory={addPlatformDirectory} previewPlatform={previewPlatform} checkPlatform={checkPlatform} busy={busy} />
        <IntegrationPanel api={api} workspace={workspace} resources={resources} integrationKind={integrationKind} setIntegrationKind={setIntegrationKind} integrationOptions={integrationOptions} integrationTargetId={integrationTargetId} setIntegrationTargetId={setIntegrationTargetId} integrationMode={integrationMode} setIntegrationMode={setIntegrationMode} integrationPaths={integrationPaths} integrationPath={integrationPath} setIntegrationPath={setIntegrationPath} integrationTarget={integrationTarget} setIntegrationTarget={setIntegrationTarget} integrationText={integrationText} setIntegrationText={setIntegrationText} integrationTargetVersion={integrationTargetVersion} setIntegrationTargetVersion={setIntegrationTargetVersion} platformSuggestion={platformSuggestion} reloadIntegrationTarget={reloadIntegrationTarget} previewIntegration={previewIntegration} friendlyError={friendlyError} setMessage={setMessage} />
      </>;
      case 'runs': return <RunsPanel api={api} workspace={workspace} />;
      case 'governance': return <GovernancePanel api={api} workspace={workspace} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />;
      case 'documents': return <DocumentPanel api={api} workspace={workspace} documentSummaries={documentSummaries} visibleDocuments={visibleDocuments} documentFilter={documentFilter} setDocumentFilter={setDocumentFilter} selectedDocument={selectedDocument} documentDraft={documentDraft} setDocumentDraft={setDocumentDraft} sensitiveConfirmed={sensitiveConfirmed} setSensitiveConfirmed={setSensitiveConfirmed} openDocument={openDocument} previewDocument={previewDocument} setMessage={setMessage} friendlyError={friendlyError} />;
      case 'audit': return <AuditPanel api={api} workspace={workspace} />;
      case 'inbox': return <InboxPanel api={api} workspace={workspace} />;
      case 'software': return <SoftwarePanel api={api} workspace={workspace} inventory={inventory} software={software} softwareResults={softwareResults} checkSoftware={checkSoftware} previewSoftwareLocation={previewSoftwareLocation} previewSoftware={previewSoftware} previewSoftwareImport={previewSoftwareImport} previewSoftwareRecipe={previewSoftwareRecipe} previewSoftwareRevert={previewSoftwareRevert} previewSoftwareConnectorLaunch={previewSoftwareConnectorLaunch} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />;
      case 'git': return <GitPanel gitDetails={gitDetails} workspace={workspace} refreshGit={refreshGit} previewGit={previewGit} sensitiveScan={sensitiveScan} platforms={inventory?.platforms} />;
      case 'safety': return <><SafetyPanel /><HelpPanel /></>;
      default: return null;
    }
  };
return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ARCHITECTURE MANAGER · {appVersion}</div>
          <h1>架构管理台</h1>
          <p className="subtitle">管理你的多平台 AI 工作区：先盘点、再计划、确认才执行</p>
        </div>
        <div className="topbar-actions">
          <button className="command-trigger" onClick={() => { setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); }} aria-label="快速跳转（Ctrl K）">
            <span>搜索 / 跳转</span><kbd>Ctrl K</kbd>
          </button>
          <button className="primary-button" onClick={async () => scan(await api.selectWorkspace())} disabled={busy}>
            {busy ? '扫描中…' : '选择工作区'}
          </button>
          <button className="small-button theme-toggle" onClick={() => setDark((value) => !value)}>{dark ? '☀ 亮色' : '☾ 暗色'}</button>
        </div>
      </header>

      <div className="app-body">
        <aside className="side-nav" aria-label="主导航">
          <div className="side-nav-head">工作台</div>
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.ids.map((id) => {
                const item = VIEWS.find((viewItem) => viewItem.id === id);
                if (!item) return null;
                const disabled = !workspace && id !== 'platform';
                return (
                  <button
                    key={id}
                    className={activeView === id ? 'nav-item active' : 'nav-item'}
                    onClick={() => openView(id)}
                    disabled={disabled}
                    aria-current={activeView === id ? 'page' : undefined}
                    title={disabled ? '先选择工作区' : VIEW_META[id]}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="side-nav-foot"><span className="status-dot" /><span>默认只读 · 写入须确认</span></div>
        </aside>

        <div className="workspace-area">
          <section className="workspace-bar">
            <span className="status-dot" />
            <span className="workspace-label">当前工作区</span>
            <code>{workspace || '尚未选择'}</code>
            <span className="read-only-badge">默认只读 · 写入须确认</span>
          </section>

          <section className="content">
            <div className="view-heading">
              <div>
                <div className="eyebrow">当前视图</div>
                <h2>{activeMeta.label}</h2>
                <p>{VIEW_META[activeMeta.id] || ''}</p>
              </div>
              <button className="small-button" onClick={() => { setPaletteOpen(true); setPaletteQuery(''); setPaletteIndex(0); }}>
                快速跳转
              </button>
            </div>
            <div className="status-region">
              <div className="status-strip" role="status" aria-live="polite">
                <span className="status-strip-label">当前状态</span>
                <span>{message}</span>
              </div>
              <TaskProgress progress={transactionProgress} api={api} workspace={workspace} session={workspaceSession} setMessage={setMessage} />
            </div>
            <div className="view-container">
              {renderView(activeView)}
            </div>
            <PlanPreview planPreview={planPreview} executePlan={executePlan} closePlan={() => { setPlanPreview(null); setPlanPayload(null); }} planWriteKinds={PLAN_WRITE_KINDS} busy={busy} />
          </section>
        </div>
      </div>

      {paletteOpen && (
        <div className="command-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <div className="command-palette" role="dialog" aria-modal="true" aria-label="快速跳转">
            <div className="command-search">
              <span aria-hidden="true">⌕</span>
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                onKeyDown={onPaletteKeyDown}
                placeholder="输入视图名，例如：平台、资源、运行、文档…"
                aria-label="搜索视图"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="command-list">
              {paletteFiltered.map((item, index) => {
                const disabled = !workspace && item.id !== 'platform';
                return (
                  <button
                    key={item.id}
                    className={index === paletteIndex ? 'command-item active' : 'command-item'}
                    onMouseEnter={() => setPaletteIndex(index)}
                    onClick={() => openView(item.id)}
                    disabled={disabled}
                  >
                    <span className="command-item-main">{item.label}</span>
                    <span className="command-item-meta">{item.group}{item.description ? ' · ' + item.description : ''}</span>
                  </button>
                );
              })}
              {paletteFiltered.length === 0 && <div className="command-empty">没有匹配的视图</div>}
            </div>
            <div className="command-foot"><span>↑ ↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></div>
          </div>
        </div>
      )}
    </main>
  );
}
