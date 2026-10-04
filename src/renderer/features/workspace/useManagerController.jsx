import { friendlyError, PLAN_WRITE_KINDS } from '../../presenter.mjs';
import {useEffect,useMemo,useState,useRef} from 'react';
import {useDomainCommands} from '../../shared/useDomainCommands.mjs';
import {useWorkspaceState} from './useWorkspaceState.mjs';
import {usePlanState} from '../../shared/usePlanState.mjs';
import {taskClient,progressMatches} from '../../shared/task-client.mjs';
import {useFeatureState as useDocumentsState} from '../documents/state.mjs';
import {useFeatureState as useSoftwareState} from '../software/state.mjs';
import {useFeatureState as useGitState} from '../git/state.mjs';
import {useFeatureState as useResourcesState} from '../resources/state.mjs';
import {useFeatureState as useIntegrationState} from '../integration/state.mjs';


export function useManagerController() {

  const { workspace, setWorkspace, workspaceSession, inventory, setInventory, busy, setBusy, message, setMessage,recordProgress } = useWorkspaceState();
  const epoch=useRef(workspaceSession);epoch.current=workspaceSession;
  const api=useMemo(()=>taskClient(window.architectureManager,workspaceSession,()=>epoch.current===workspaceSession),[workspaceSession]);
  const { planPreview, setPlanPreview, planPayload, setPlanPayload } = usePlanState(workspaceSession);
  const modelRef=useRef({});
  const commands=useDomainCommands(modelRef,workspaceSession);
  const {scan,refreshGit,previewGit,reloadIntegrationTarget,previewIntegration,previewPlatform,checkPlatform,addPlatformDirectory,openCatalog,previewRegistryAction,previewResource,openDocument,previewDocument,checkSoftware,previewSoftware,previewSoftwareImport,previewSoftwareRecipe,previewSoftwareLocation,previewSoftwareConnectorLaunch,previewSoftwareRevert,executePlan}=commands;
  const [appVersion, setAppVersion] = useState('读取中');
  useEffect(() => { api.getAppVersion().then(setAppVersion).catch(() => setAppVersion('版本未读取')); }, []);
  const [transactionProgress, setTransactionProgress] = useState(null);
  useEffect(()=>setTransactionProgress(null),[workspaceSession]);
  const [showExcluded, setShowExcluded] = useState(false);
  const {selectedDocument,setSelectedDocument,documentDraft,setDocumentDraft,sensitiveConfirmed,setSensitiveConfirmed,documentFilter,setDocumentFilter}=useDocumentsState(workspaceSession);

  const {softwareResults,setSoftwareResults}=useSoftwareState(workspaceSession);
  const {gitDetails,setGitDetails,sensitiveScan,setSensitiveScan}=useGitState(workspaceSession);
  
  const {catalogDetail,setCatalogDetail,catalogFilter,setCatalogFilter,skillDetail,setSkillDetail,skillFilter,setSkillFilter,resourceFilter,setResourceFilter,targetVersions,setTargetVersions}=useResourcesState(workspaceSession);

  const {integrationKind,setIntegrationKind,integrationTargetId,setIntegrationTargetId,integrationMode,setIntegrationMode,integrationPaths,setIntegrationPaths,integrationPath,setIntegrationPath,integrationTarget,setIntegrationTarget,integrationText,setIntegrationText,integrationTargetVersion,setIntegrationTargetVersion,platformSuggestion,setPlatformSuggestion}=useIntegrationState(workspaceSession);

  const [dark, setDark] = useState(() => localStorage.getItem('am-theme') === 'dark');
  useEffect(() => {
    document.body.classList.toggle('dark', dark);
    localStorage.setItem('am-theme', dark ? 'dark' : 'light');
  }, [dark]);
  const [view, setView] = useState(() => localStorage.getItem('am-view') || 'dashboard');
  useEffect(() => { localStorage.setItem('am-view', view); }, [view]);
  const VIEWS = [
    { id: 'dashboard', label: '仪表盘' },
    { id: 'resources', label: '资源' },
    { id: 'intake', label: '导入本体' },
    { id: 'platform', label: '平台与接入' },
    { id: 'runs', label: '运行' },
    { id: 'governance', label: '治理' },
    { id: 'documents', label: '文档' },
    { id: 'audit', label: '审计' },
    { id: 'inbox', label: 'inbox' },
    { id: 'software', label: '软件' },
    { id: 'git', label: '仓库' },
    { id: 'safety', label: '安全/帮助' }
  ];
  const activeView = workspace ? view : 'platform';

  useEffect(() => {
    if (view !== 'git' || !workspace || gitDetails) return;
    let valid = true;
    api.inspectGit(workspace).then((details) => { if(valid) { setGitDetails(details); setInventory((current) => current ? {...current,git:details}:current); } }).catch((error)=>{if(valid) setMessage(`Git 状态读取失败：${friendlyError(error)}`);});
    return () => {valid=false;};
  },[view,workspace,gitDetails]);

  useEffect(() => api.onTransactionProgress(progress=>{
    if(!progressMatches(progress,workspace,workspaceSession)) return;
    recordProgress(progress);
    setTransactionProgress(progress.state==='settled'?null:progress);
  }), [api,workspace,workspaceSession,recordProgress]);

  useEffect(() => {
    if (planPreview) document.getElementById('plan-preview')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [planPreview]);
  useEffect(() => {
    if (catalogDetail || skillDetail) document.querySelector('.catalog-detail:last-of-type')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [catalogDetail, skillDetail]);
  useEffect(() => {
    if (selectedDocument) document.querySelector('.editor-box')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedDocument]);


  useEffect(() => {
    api.getDefaultWorkspace().then((root) => root && scan(root)).catch((error) => setMessage(`启动失败：${friendlyError(error)}`));
  }, []);

  const gitState = useMemo(() => {
    if (!inventory?.git) return '未扫描';
    if (inventory.git.error) return '不可用';
    if (!inventory.git.isRepository) return '未绑定 Git';
    return inventory.git.status.length === 0 ? '干净' : `${inventory.git.status.length} 项改动`;
  }, [inventory]);

  const resources = useMemo(() => (inventory?.sharedRepositories || []).flatMap((repo) => (
    (repo.pointers || []).map((pointer) => ({ ...pointer, repository: repo.repository }))
  )), [inventory]);

  const documentSummaries = inventory?.documentSummaries || [];
  const visibleDocuments = useMemo(() => documentSummaries.filter((item) => !documentFilter || item.path.toLowerCase().includes(documentFilter.toLowerCase()) || item.kind.includes(documentFilter.toLowerCase())), [documentSummaries, documentFilter]);
  const software = inventory?.software || [];
  const agents = useMemo(() => (inventory?.agents || []).filter((item) => !catalogFilter || item.id.toLowerCase().includes(catalogFilter.toLowerCase())), [inventory, catalogFilter]);
  const skills = useMemo(() => (inventory?.skills || []).filter((item) => !catalogFilter || item.id.toLowerCase().includes(catalogFilter.toLowerCase())), [inventory, catalogFilter]);
  const integrationOptions = useMemo(() => {
    if (integrationKind === 'platform') return (inventory?.platforms || []).map((item) => ({ id: item.id, label: item.id }));
    if (integrationKind === 'software') return (inventory?.software || []).map((item) => ({ id: item.id, label: `${item.id} · ${item.version || '无 current'}` }));
    return [{ id: '__registry__', label: `${integrationKind}/registry.json（共享仓）` }, ...resources.filter((item) => item.repository === integrationKind).map((item) => ({ id: item.resourceId, label: `${item.resourceId} · ${item.version || '无 current'}` }))];
  }, [integrationKind, inventory, resources]);

  useEffect(() => {
    const first = integrationOptions[0]?.id || '';
    if (!integrationOptions.some((item) => item.id === integrationTargetId)) setIntegrationTargetId(first);
  }, [integrationOptions, integrationTargetId]);

  useEffect(() => {
    if (!workspace || !integrationTargetId) return;
    let cancelled = false;
    (async () => {
      try {
        const listed = await api.listIntegrationTargets({ workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId });
        if (cancelled) return;
        const preferred = integrationKind === 'platform' || integrationMode === 'config' ? listed.paths[0] : listed.paths.find((path) => path.endsWith(`/${integrationMode === 'pointer' ? 'current.json' : 'registry.json'}`)) || listed.paths[0];
        setIntegrationPaths(listed.paths);
        setIntegrationPath(preferred || '');
        if (preferred) {
          const detail = await api.readIntegrationTarget({ workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId, relativePath: preferred });
          if (cancelled) return;
          setIntegrationTarget(detail);
          if (integrationKind === 'platform') {
            const suggested = await api.suggestPlatformBridge({ workspaceRoot: workspace, platformId: integrationTargetId });
            if (cancelled) return;
            setPlatformSuggestion(suggested);
            setIntegrationText(suggested.afterText);
          } else {
            setPlatformSuggestion(null);
            setIntegrationText(detail.content || '');
          }
          if (integrationMode === 'pointer') setIntegrationTargetVersion('');
        }
      } catch (error) {
        if (!cancelled) setMessage(`接入目标读取失败：${friendlyError(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [workspace, integrationKind, integrationTargetId, integrationMode]);


  const model={workspace,setWorkspace,workspaceSession,inventory,setInventory,busy,setBusy,message,setMessage,recordProgress,api,planPreview,setPlanPreview,planPayload,setPlanPayload,appVersion,setAppVersion,transactionProgress,setTransactionProgress,showExcluded,setShowExcluded,selectedDocument,setSelectedDocument,documentDraft,setDocumentDraft,sensitiveConfirmed,setSensitiveConfirmed,softwareResults,setSoftwareResults,gitDetails,setGitDetails,sensitiveScan,setSensitiveScan,catalogDetail,setCatalogDetail,catalogFilter,setCatalogFilter,documentFilter,setDocumentFilter,skillDetail,setSkillDetail,skillFilter,setSkillFilter,resourceFilter,setResourceFilter,targetVersions,setTargetVersions,integrationKind,setIntegrationKind,integrationTargetId,setIntegrationTargetId,integrationMode,setIntegrationMode,integrationPaths,setIntegrationPaths,integrationPath,setIntegrationPath,integrationTarget,setIntegrationTarget,integrationText,setIntegrationText,integrationTargetVersion,setIntegrationTargetVersion,platformSuggestion,setPlatformSuggestion,dark,setDark,view,setView,VIEWS,activeView,scan,refreshGit,gitState,resources,documentSummaries,visibleDocuments,software,agents,skills,integrationOptions,reloadIntegrationTarget,previewIntegration,previewPlatform,checkPlatform,addPlatformDirectory,openCatalog,previewRegistryAction,previewResource,openDocument,previewDocument,checkSoftware,previewSoftware,previewSoftwareImport,previewSoftwareRecipe,previewSoftwareLocation,previewSoftwareConnectorLaunch,previewSoftwareRevert,previewGit,executePlan,friendlyError,PLAN_WRITE_KINDS};
  modelRef.current=model;
  return model;

}
