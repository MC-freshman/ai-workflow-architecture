import {TaskProgress} from '../../shared/TaskProgress.jsx';
import React, { useEffect, useState } from 'react';
import { PlanPreview } from '../../panels/plan-preview.jsx';
import { friendlyError, PLAN_WRITE_KINDS } from '../../presenter.mjs';
import registry from '../../../app/module-registry.json';
import { ViewRenderer } from './ViewRenderer.jsx';


// Navigation groups and view metadata are registry-driven (P3, approved P-table 20261111).
const NAV_GROUPS = registry.views.reduce((groups, view) => {
  let group = groups.find((entry) => entry.label === view.group);
  if (!group) { group = { label: view.group, ids: [] }; groups.push(group); }
  group.ids.push(view.id);
  return groups;
}, []);

const VIEW_META = Object.fromEntries(registry.views.map((view) => [view.id, view.description]));

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

// View composition is registry-driven (P3): panels, sections, enabled/replacement state
// come from module-registry.json; lazy loaders live in panel-loaders.mjs.
const renderView = (active) => <ViewRenderer viewId={active} model={model} />;
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
