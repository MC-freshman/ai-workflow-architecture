import {GlobalUpdatePanel} from '../../panels/global-update.jsx';
import {TaskProgress} from '../../shared/TaskProgress.jsx';
import {BodyIntakePanel} from '../../features/intake/BodyIntakePanel.jsx';
import React from 'react';
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


export function WorkspaceScreen(model) {
  const {workspace,setWorkspace,workspaceSession,inventory,setInventory,busy,setBusy,message,setMessage,recordProgress,api,planPreview,setPlanPreview,planPayload,setPlanPayload,appVersion,setAppVersion,transactionProgress,setTransactionProgress,showExcluded,setShowExcluded,selectedDocument,setSelectedDocument,documentDraft,setDocumentDraft,sensitiveConfirmed,setSensitiveConfirmed,softwareResults,setSoftwareResults,gitDetails,setGitDetails,sensitiveScan,setSensitiveScan,catalogDetail,setCatalogDetail,catalogFilter,setCatalogFilter,documentFilter,setDocumentFilter,skillDetail,setSkillDetail,skillFilter,setSkillFilter,resourceFilter,setResourceFilter,targetVersions,setTargetVersions,integrationKind,setIntegrationKind,integrationTargetId,setIntegrationTargetId,integrationMode,setIntegrationMode,integrationPaths,setIntegrationPaths,integrationPath,setIntegrationPath,integrationTarget,setIntegrationTarget,integrationText,setIntegrationText,integrationTargetVersion,setIntegrationTargetVersion,platformSuggestion,setPlatformSuggestion,dark,setDark,view,setView,VIEWS,activeView,scan,refreshGit,gitState,resources,documentSummaries,visibleDocuments,software,agents,skills,integrationOptions,reloadIntegrationTarget,previewIntegration,previewPlatform,checkPlatform,addPlatformDirectory,openCatalog,previewRegistryAction,previewResource,openDocument,previewDocument,checkSoftware,previewSoftware,previewSoftwareImport,previewSoftwareRecipe,previewSoftwareLocation,previewSoftwareConnectorLaunch,previewSoftwareRevert,previewGit,executePlan,inspectAnchor,previewAnchor,previewAnchorAlignment,anchorReport,friendlyError,PLAN_WRITE_KINDS}=model;
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
          <p className="subtitle">独立用户版 · 只读盘点 + 计划式接入</p>
        </div>
        <div className="topbar-actions">
          <button className="primary-button" onClick={async () => scan(await api.selectWorkspace())} disabled={busy}>
            {busy ? '扫描中…' : '选择工作区'}
          </button>
          <button className="small-button theme-toggle" onClick={() => setDark((value) => !value)}>{dark ? '☀ 亮色' : '☾ 暗色'}</button>
        </div>
      </header>
      <nav className="view-tabs" aria-label="视图">
        {VIEWS.map((item) => <button key={item.id} className={activeView === item.id ? 'view-tab active' : 'view-tab'} onClick={() => setView(item.id)}>{item.label}</button>)}
      </nav>

      <section className="workspace-bar">
        <span className="status-dot" />
        <span className="workspace-label">当前工作区</span>
        <code>{workspace || '尚未选择'}</code>
        <span className="read-only-badge">默认只读 · 写入须确认</span>
      </section>

      <section className="content">
        <div className="notice" role="status" aria-live="polite"><strong>当前状态：</strong>{message}</div>
        <TaskProgress progress={transactionProgress} api={api} workspace={workspace} session={workspaceSession} setMessage={setMessage} />
        <div className="view-container">
          {renderView(activeView)}
        </div>
        <PlanPreview planPreview={planPreview} executePlan={executePlan} closePlan={() => { setPlanPreview(null); setPlanPayload(null); }} planWriteKinds={PLAN_WRITE_KINDS} busy={busy} />
      </section>
    </main>
  );
}
