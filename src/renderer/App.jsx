import {TaskProgress} from './shared/TaskProgress.jsx';
import {BodyIntakePanel} from './features/intake/BodyIntakePanel.jsx';
import { useWorkspaceState } from './features/workspace/useWorkspaceState.mjs';
import { usePlanState } from './shared/usePlanState.mjs';
import { taskClient,progressMatches } from './shared/task-client.mjs';
import React, { useEffect, useMemo, useState } from 'react';
import {
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
} from './components.jsx';
import { friendlyError, PLAN_WRITE_KINDS } from './presenter.mjs';

export default function App() {
  const { workspace, setWorkspace, workspaceSession, inventory, setInventory, busy, setBusy, message, setMessage,recordProgress } = useWorkspaceState();
  const api=useMemo(()=>taskClient(window.architectureManager,workspaceSession),[workspaceSession]);
  const { planPreview, setPlanPreview, planPayload, setPlanPayload } = usePlanState();
  const [appVersion, setAppVersion] = useState('读取中');
  useEffect(() => { api.getAppVersion().then(setAppVersion).catch(() => setAppVersion('版本未读取')); }, []);
  const [transactionProgress, setTransactionProgress] = useState(null);
  useEffect(()=>setTransactionProgress(null),[workspaceSession]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentDraft, setDocumentDraft] = useState('');
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [softwareResults, setSoftwareResults] = useState({});
  const [gitDetails, setGitDetails] = useState(null);
  const [sensitiveScan, setSensitiveScan] = useState(null);
  const [catalogDetail, setCatalogDetail] = useState(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [documentFilter, setDocumentFilter] = useState('');
  const [skillDetail, setSkillDetail] = useState(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [targetVersions, setTargetVersions] = useState({});
  const [integrationKind, setIntegrationKind] = useState('platform');
  const [integrationTargetId, setIntegrationTargetId] = useState('');
  const [integrationMode, setIntegrationMode] = useState('config');
  const [integrationPaths, setIntegrationPaths] = useState([]);
  const [integrationPath, setIntegrationPath] = useState('');
  const [integrationTarget, setIntegrationTarget] = useState(null);
  const [integrationText, setIntegrationText] = useState('');
  const [integrationTargetVersion, setIntegrationTargetVersion] = useState('');
  const [platformSuggestion, setPlatformSuggestion] = useState(null);
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

  const scan = async (root) => {
    if (!root) return;
    setBusy(true);
    setMessage('正在只读扫描工作区……');
    try {
      const result = await api.scanWorkspace(root);
      setWorkspace(result.workspaceRoot);
      setInventory(result);
      setGitDetails(result.git);
      setPlanPreview(null); setPlanPayload(null); setSelectedDocument(null); setCatalogDetail(null); setSkillDetail(null); setSoftwareResults({});
      setMessage(result.errors.length === 0 ? '扫描完成，当前页面没有执行写入。' : `扫描完成，发现 ${result.errors.length} 个待处理问题。`);
    } catch (error) {
      setMessage(`扫描失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const refreshGit = async () => {
    if (!workspace) return;
    try {
      const [details, scanResult] = await Promise.all([
        api.inspectGit(workspace),
        api.scanSensitiveFiles(workspace)
      ]);
      setGitDetails(details);
      setInventory((current) => current ? { ...current, git: details } : current);
      setSensitiveScan(scanResult);
      setMessage(`Git 状态已刷新：${details.status?.length || 0} 项改动，敏感文件扫描 ${scanResult.clean ? '通过' : `发现 ${scanResult.findings.length} 项待核对`}。`);
    } catch (error) {
      setMessage(`Git 状态读取失败：${friendlyError(error)}`);
    }
  };

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

  const reloadIntegrationTarget = async () => {
    if (!workspace || !integrationTargetId || !integrationPath) { setMessage('请先选择接入对象和目标文件。'); return; }
    try {
      const detail = await api.readIntegrationTarget({ workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId, relativePath: integrationPath });
      setIntegrationTarget(detail);
      if (integrationKind === 'platform') {
        const suggested = await api.suggestPlatformBridge({ workspaceRoot: workspace, platformId: integrationTargetId });
        setPlatformSuggestion(suggested); setIntegrationText(suggested.afterText);
      } else setIntegrationText(detail.content || '');
      setMessage(`已重新读取 ${detail.path}，基线哈希已更新。`);
    } catch (error) { setMessage(`接入目标读取失败：${friendlyError(error)}`); }
  };

  const previewIntegration = async () => {
    if (!workspace || !integrationTarget || !integrationPath) { setMessage('接入目标尚未读到，请选择对象或重新读取目标。'); return; }
    try {
      const input = { workspaceRoot: workspace, kind: integrationKind, targetId: integrationTargetId, mode: integrationMode, relativePath: integrationPath, beforeText: integrationTarget.content, afterText: integrationText, baselineSha256: integrationTarget.sha256 };
      if (integrationMode === 'pointer') {
        const resource = resources.find((item) => item.repository === integrationKind && item.resourceId === integrationTargetId);
        input.currentVersion = resource?.version;
        input.targetVersion = integrationTargetVersion;
        input.availableVersions = resource?.availableVersions || [];
      }
      const plan = await api.previewIntegrationPlan(input);
      setPlanPreview(plan);
      setPlanPayload(plan.payload?.afterText ? { afterText: plan.payload.afterText } : null);
      setMessage(`已生成 ${integrationKind}/${integrationTargetId} 接入计划，尚未写入。`);
    } catch (error) { setMessage(`接入计划被拒绝：${friendlyError(error)}`); }
  };

  const previewPlatform = async (platform) => {
    const currentEnabled = platform.enabled;
    const desiredEnabled = !currentEnabled;
    try {
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId: platform.id, currentEnabled, desiredEnabled, directoryRelative: platform.directoryRelative, markers: platform.markers });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成本地视图计划：${platform.id} 将${desiredEnabled ? '显示' : '排除'}。尚未写入。`);
    } catch (error) {
      setMessage(`计划生成失败：${friendlyError(error)}`);
    }
  };

  const checkPlatform = async (platform, mode) => {
    if (!workspace) return;
    setBusy(true);
    try {
      setMessage('正在计算受影响范围，尚未执行矩阵……');
      const scope=await api.previewPlatformCheck({workspaceRoot:workspace,platformId:platform.id,mode});
      const label=scope.kind==='full'?'首次或大版本完整认证':scope.kind==='resume-first'?'继续首次认证':'增量检查';
      const detail=scope.selected.map(key=>key+'：'+scope.reasons[key].join('；')).join('\n');
      if(!await api.confirm('确认对 '+platform.id+' 运行'+label+'？\n本次实测 '+scope.selected.length+' 格；沿用 '+scope.reused.length+' 格原证据。\n'+detail)) return;
      setMessage('正在检查 '+platform.id+'，本次实测 '+scope.selected.length+' 格……');
      const result=await api.runPlatformCheck({workspaceRoot:workspace,platformId:platform.id,mode,expectedScopeDigest:scope.scopeDigest});
      const refreshed=await api.refreshPlatform({workspaceRoot:workspace,platformId:platform.id});
      setInventory(current=>({...current,platforms:current.platforms.map(item=>item.id===platform.id?refreshed:item)}));
      setMessage(platform.id+' 检查结果：'+result.stage+'；实测 '+(result.provenance?.actualRows ?? 0)+' 格，沿用 '+(result.provenance?.reusedRows ?? 0)+' 格；'+(result.issues.length?result.issues.join('；'):'无缺口')+'。证据：'+result.evidencePath);
    } catch(error) {setMessage(platform.id+' 检查失败：'+friendlyError(error));}
    finally {setBusy(false);setTransactionProgress(null);}
  };

  const addPlatformDirectory = async () => {
    if (!workspace) return;
    const selected = await api.selectDirectory();
    if (!selected) { setMessage('已取消选择平台目录，未生成计划。'); return; }
    const platformId = selected.split(/[\\/]/).filter(Boolean).pop();
    if (!inventory?.platforms?.some((item) => item.id === platformId)) {
      setMessage(`未识别的平台目录：${platformId}。请选择已有合法 bridge.json 的平台，或使用接入向导创建并配置新平台。`);
      return;
    }
    try {
      const inspected = await api.inspectPlatform({ workspaceRoot: workspace, platformId, directoryRelative: selected });
      if (!inspected.validForView) {
        setMessage(`平台目录校验未通过：${inspected.status}。需要目录和 bridge 标记文件。`);
        return;
      }
      const currentEnabled = inventory.platforms.find((item) => item.id === platformId)?.enabled ?? false;
      const plan = await api.previewPlatformPlan({ workspaceRoot: workspace, platformId, currentEnabled, desiredEnabled: true, directoryRelative: inspected.directoryRelative, markers: inspected.markers });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已验证 ${platformId}：bridge 和目录标记齐全，生成加入管理视图计划。`);
    } catch (error) {
      setMessage(`平台目录验证失败：${friendlyError(error)}`);
    }
  };

  const openCatalog = async (kind, id) => {
    try {
      setCatalogDetail(await api.readCatalogEntry({ workspaceRoot: workspace, kind, id }));
      setSkillDetail(null); setSkillFilter('');
      setMessage(`已打开 ${kind}/${id} 全部内容，可在当前面板下方查看。`);
    } catch (error) {
      setMessage(`读取${kind === 'agent' ? 'agent' : 'skill'}内容失败：${friendlyError(error)}`);
    }
  };

  const previewRegistryAction = async (kind, action, item = null) => {
    if (!workspace || !inventory?.catalogRegistries?.[kind]?.sha256) { setMessage('缺少 registry 基线哈希，请重新扫描工作区。'); return; }
    let id = item?.id;
    try {
      let entry = {};
      if (action === 'add') {
        const selected = await api.selectCatalog({ workspaceRoot: workspace, kind });
        if (!selected) { setMessage('已取消选择文件，未生成 registry 计划。'); return; }
        id = selected.id; entry = selected.entry;
      }
      if (!id) { setMessage('所选资源缺少 ID，无法生成 registry 计划。'); return; }
      const plan = await api.previewRegistryPlan({ workspaceRoot: workspace, kind, action, id, entry, baselineSha256: inventory.catalogRegistries[kind].sha256 });
      setPlanPreview(plan);
      setPlanPayload({ afterText: plan.payload.afterText });
      setMessage(`已生成 ${kind} registry ${action} 计划，尚未写入。`);
    } catch (error) {
      setMessage(`registry 计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewResource = async (resource, selectedVersion = null) => {
    const target = selectedVersion || targetVersions[`${resource.repository}/${resource.resourceId}`] || (resource.latestStableVersion !== resource.version ? resource.latestStableVersion : null);
    if (!target) { setMessage('请先选择目标版本。'); return; }
    try {
      const plan = await api.previewResourcePlan({
        workspaceRoot: workspace,
        repository: resource.repository,
        resourceId: resource.resourceId,
        currentVersion: resource.version,
        targetVersion: target,
        availableVersions: resource.availableVersions,
        baselineSha256: resource.sha256
      });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成资源指针计划：${resource.repository}/${resource.resourceId}。尚未写入。`);
    } catch (error) {
      setMessage(`资源计划被拒绝：${friendlyError(error)}`);
    }
  };

  const openDocument = async (path) => {
    try {
      const document = await api.readDocument({ workspaceRoot: workspace, relativePath: path });
      setSelectedDocument(document);
      setDocumentDraft(document.content);
      setSensitiveConfirmed(false);
      setMessage(`已读取 ${path}，编辑仍只在本地内存中。`);
    } catch (error) {
      setMessage(`文档读取失败：${friendlyError(error)}`);
    }
  };

  const previewDocument = async () => {
    if (!selectedDocument) return;
    try {
      const plan = await api.previewDocumentPlan({
        workspaceRoot: workspace,
        relativePath: selectedDocument.path,
        beforeText: selectedDocument.content,
        afterText: documentDraft,
        baselineSha256: selectedDocument.sha256,
        highSensitivityConfirmed: sensitiveConfirmed
      });
      setPlanPreview(plan);
      setPlanPayload({ afterText: documentDraft });
      setMessage(`已生成文档变更计划：${selectedDocument.path}。尚未写入。`);
    } catch (error) {
      setMessage(`文档计划被拒绝：${friendlyError(error)}`);
    }
  };

  const checkSoftware = async (item,platformId) => {
    setBusy(true);
    try {
      const result = await api.softwareHealth({ workspaceRoot: workspace, softwareId: item.id,platformId });
      setSoftwareResults((state) => ({ ...state, [platformId+'/'+item.id]: result }));
      setMessage(`${platformId}/${item.id} 健康检查：${result.description || result.status}`);
    } catch (error) {
      setMessage(`软件健康检查失败：${friendlyError(error)}`);
    } finally {setBusy(false);setTransactionProgress(null);}
  };

  const previewSoftware = async (item) => {
    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, mode: 'launch' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已列出 ${item.id} 的启动条件。当前管理台没有启动执行器，未启动软件。`);
    } catch (error) {
      setMessage(`软件启动计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewSoftwareImport = async (selection) => {
    try {
      const plan = await api.previewSoftwareImportPlan({ workspaceRoot: workspace, ...selection });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(`已生成 ${selection.softwareId} 安置与备份计划：${plan.rows.length} 个文件，预计新增 ${Math.ceil((plan.estimatedAdditionalBytes || 0) / 1024 / 1024)} MiB（备份 + 本体，不含原下载文件）；尚未复制。`);
    } catch (error) { setMessage(`软件安置计划被拒绝：${friendlyError(error)}`); }
  };

  const previewSoftwareRecipe = async (selection) => {
    if (!await api.confirm(`确认只读询问 ${selection.softwareId} 的版本？\n\n管理台会启动你选定的程序并传入 ${selection.versionFlag}；程序本身仍可能有副作用。请仅对可信软件继续。`)) return;
    try {
      const plan = await api.previewSoftwareRecipePlan({ workspaceRoot: workspace, ...selection });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(`已从真实程序取得版本输出并生成配方计划；尚未发布，且只声明“版本查询”能力。`);
    } catch (error) { setMessage(`配方计划被拒绝：${friendlyError(error)}`); }
  };

  const previewSoftwareLocation = async (item, platformId) => {
    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, platformId, mode: 'open-location' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成打开 ${item.id} 本体目录的计划，确认后才会打开资源管理器。`);
    } catch (error) {
      setMessage(`软件位置计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewSoftwareConnectorLaunch = async (item, platformId) => {
    if (!workspace || !platformId) return;
    try {
      const plan = await api.previewSoftwareConnectorLaunchPlan({ workspaceRoot: workspace, platformId, softwareId: item.id });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 ${item.id} 经 ${platformId} 连接器的启动计划；连接器的答复会原样转达（含 INTERACTIVE_REQUIRED / 漂移），不会美化。`);
    } catch (error) {
      setMessage(`启动计划被拒绝：${friendlyError(error)}`);
    }
  };

  const previewSoftwareRevert = async (item) => {
    try {
      const plan = await api.previewSoftwareRevertPlan({ workspaceRoot: workspace, checkpointPath: item.checkpointPath });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(item.action === 'software-import' ? '已生成撤销安置计划：本体将移入 inbox/trash，备份保留。' : '已生成停用发布计划：解除连接器绑定并停用 registry 条目，已发布版本保留。');
    } catch (error) { setMessage(`软件撤销计划被拒绝：${friendlyError(error)}`); }
  };

  const previewGit = async (action) => {
    if (!workspace) return;
    const input = { workspaceRoot: workspace, action };
    if (action === 'commit') {
      input.message = window.prompt('输入提交说明（≥3 字）', '更新架构工作区') || '';
      input.paths = (window.prompt('输入要提交的相对路径（每行一个；禁止 . 、 -A 、通配符与绝对路径）', '') || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    if (action === 'branch') input.branch = window.prompt('输入新分支名', '') || '';
    if (action === 'tag') input.tag = window.prompt('输入新标签名', '') || '';
    if (action === 'push') input.remote = window.prompt('输入远端名称', 'origin') || '';
    if (action === 'rollback') input.commit = window.prompt('输入要回滚的提交 SHA（将生成 revert 计划）', '') || '';
    if (action === 'backup') { input.backupMode='history'; input.platformId=window.prompt('选择备份归属平台：'+(inventory?.platforms || []).map(item=>item.id).join('、'),inventory?.platforms?.[0]?.id || '') || ''; }
    if (action === 'snapshot') { input.action='backup'; input.backupMode='snapshot'; }
    if (action === 'backup' || action === 'snapshot') input.backupName = window.prompt('输入备份名称', `before-${new Date().toISOString().slice(0, 10)}`) || '';
    try {
      const plan = await api.previewGitPlan(input);
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 Git ${action} 计划。尚未执行任何 Git 命令。`);
    } catch (error) {
      setMessage(`Git 计划被拒绝：${friendlyError(error)}`);
    }
  };

  const executePlan = async () => {
    if (!planPreview) return;
    if (planPreview.kind === 'software-action' && planPreview.target?.mode === 'open-location') {
      if (!await api.confirm(`确认打开软件目录？\n\n${planPreview.target.bodyPath}`)) return;
      try {
        await api.openSoftwareLocation({ workspaceRoot: workspace, softwareId: planPreview.target.softwareId, platformId: planPreview.target.platformId, expectedPath: planPreview.target.bodyPath });
        setPlanPreview(null);
        setMessage('已打开软件本体目录。');
      } catch (error) {
        setMessage(`软件目录打开失败：${friendlyError(error)}`);
      }
      return;
    }
    if (!PLAN_WRITE_KINDS.includes(planPreview.kind)) return;
    const target = planPreview.target?.path || (planPreview.target?.platformId ? `平台：${planPreview.target.platformId}` : `${planPreview.target?.repository}/${planPreview.target?.resourceId}/current.json`);
    if (!await api.confirm(`确认执行此计划？\n\n目标：${target}\n\n执行前会再次核对文件状态，失败会阻止覆盖。`)) return;
    setBusy(true);
    setTransactionProgress(null);
    try {
      const applied = await api.applyPlan({ plan: planPreview, afterText: planPayload?.afterText, credentialValue:planPayload?.credentialValue, actor: 'local-user' });
      if(planPreview.kind==='mcp-credential')setPlanPayload(null);
      if(applied.stoppedAfterCompletion) {
        setMessage('停止请求到达时当前原子步骤已完成；结果已保留，后续验证尚未运行。请重新扫描并查看审计记录。');
        setPlanPreview(null);setPlanPayload(null);return;
      }
      if (planPreview.kind === 'platform-onboarding' && applied.status !== 'complete') {
        setMessage(`接入已停止在 ${applied.stoppedAt || applied.currentStep || '未完成步骤'}：${friendlyError(new Error(applied.error || '检查未通过'))}。修正后可点击“预览一键接入／继续”，已通过步骤保留。`);
        return;
      }
      const verification = await api.verifyPlan({ plan: planPreview });
      const refreshed = await api.scanWorkspace(workspace);
      setInventory(refreshed);
      if (refreshed.git) setGitDetails(refreshed.git);
      if (integrationTargetId && integrationPath) await reloadIntegrationTarget();
      setIntegrationTargetVersion('');
      setTargetVersions({});
      setPlanPreview(null);
      setPlanPayload(null);
      if(planPreview.kind==='platform-body') {setMessage(verification.ok?'平台本体安置和真实恢复已通过；'+(applied.nativeStatus==='interface-required'?'原生接口仍待补齐。':'客户端需点击真实入口测试。')+'能力地板、首次认证和入库通过后才算架构接入完成。':'本体回读未通过，请查看接入记录。');return;}
      if(planPreview.kind==='software-command') {setMessage(applied.reply?.ok?'连接器已返回真实结果：'+(applied.reply.state || planPreview.target.capability)+'；版本、会话和具体功能分别记录。':'连接器拒绝本次操作：'+friendlyError(applied.reply?.error?.code || 'SOFTWARE_CONNECTOR_FAILED'));return;}
setMessage(planPreview.kind === 'software-launch' ? `连接器答复：${applied.connectorStatus}。${applied.connectorReply?.error?.message || ''}启动只在连接器明确返回存活会话时成立。` : planPreview.kind === 'software-import' ? `软件本体安置与恢复演练${verification.ok ? '通过' : '未通过'}；尚未发布配方，也未接入连接器。` : planPreview.kind === 'software-recipe-publish' ? applied.status === 'published-version-only' && verification.ok ? `版本查询已发布，连接器健康检查和单格认证均通过；其它功能尚需适配。` : `配方文件${verification.ok ? '已发布' : '回读失败'}，但软件仍待验证：${applied.check?.issues?.join('；') || '缺少健康检查结果'}。` : planPreview.kind === 'software-revert' ? `软件撤销/停用${verification.ok ? '已验证' : '验证未通过'}；${applied.releaseRetained ? '已发布版本按只读规则保留。' : '备份保留，本体已移入垃圾桶。'}` : `计划已${applied.status === 'already-applied' ? '确认已执行' : '执行'}，验证${verification.ok ? '通过' : '未通过'}。`);
    } catch (error) {
      setMessage(`计划执行失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
      setTransactionProgress(null);
    }
  };

  const renderView = (active) => {
    switch (active) {
      case 'dashboard': return <>
        <DashboardStats inventory={inventory} gitState={gitState} />
        <HomePulse api={api} workspace={workspace} />
        <PlanCenterPanel api={api} workspace={workspace} />
      </>;
      case 'resources': return <>
        <ResourcePanel api={api} workspace={workspace} inventory={inventory} resources={resources} resourceFilter={resourceFilter} setResourceFilter={setResourceFilter} targetVersions={targetVersions} setTargetVersions={setTargetVersions} previewResource={previewResource} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} />
        <ReleasePanel api={api} workspace={workspace} inventory={inventory} resources={resources} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />
        <CatalogPanel api={api} workspace={workspace} inventory={inventory} catalogFilter={catalogFilter} setCatalogFilter={setCatalogFilter} agents={agents} skills={skills} skillFilter={skillFilter} setSkillFilter={setSkillFilter} catalogDetail={catalogDetail} setCatalogDetail={setCatalogDetail} skillDetail={skillDetail} setSkillDetail={setSkillDetail} openCatalog={openCatalog} previewRegistryAction={previewRegistryAction} friendlyError={friendlyError} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />
      </>;
      case 'intake': return <BodyIntakePanel key={workspaceSession} api={api} workspace={workspace} inventory={inventory} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />;
      case 'platform': return <>
        {!workspace && <ClonePanel api={api} onCloned={(root) => scan(root)} setMessage={setMessage} friendlyError={friendlyError} />}
        <OnboardPanel api={api} workspace={workspace} inventory={inventory} busy={busy} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />
        <PlatformPanel inventory={inventory} showExcluded={showExcluded} setShowExcluded={setShowExcluded} addPlatformDirectory={addPlatformDirectory} previewPlatform={previewPlatform} checkPlatform={checkPlatform} busy={busy} />
        <IntegrationPanel api={api} workspace={workspace} resources={resources} integrationKind={integrationKind} setIntegrationKind={setIntegrationKind} integrationOptions={integrationOptions} integrationTargetId={integrationTargetId} setIntegrationTargetId={setIntegrationTargetId} integrationMode={integrationMode} setIntegrationMode={setIntegrationMode} integrationPaths={integrationPaths} integrationPath={integrationPath} setIntegrationPath={setIntegrationPath} integrationTarget={integrationTarget} setIntegrationTarget={setIntegrationTarget} integrationText={integrationText} setIntegrationText={setIntegrationText} integrationTargetVersion={integrationTargetVersion} setIntegrationTargetVersion={setIntegrationTargetVersion} platformSuggestion={platformSuggestion} reloadIntegrationTarget={reloadIntegrationTarget} previewIntegration={previewIntegration} friendlyError={friendlyError} setMessage={setMessage} />
      </>;
      case 'runs': return <RunsPanel api={api} workspace={workspace} />;
      case 'governance': return <GovernancePanel api={api} workspace={workspace} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} setMessage={setMessage} friendlyError={friendlyError} />;
      case 'documents': return <DocumentPanel api={api} workspace={workspace} documentSummaries={documentSummaries} visibleDocuments={visibleDocuments} documentFilter={documentFilter} setDocumentFilter={setDocumentFilter} selectedDocument={selectedDocument} documentDraft={documentDraft} setDocumentDraft={setDocumentDraft} sensitiveConfirmed={sensitiveConfirmed} setSensitiveConfirmed={setSensitiveConfirmed} openDocument={openDocument} previewDocument={previewDocument} setMessage={setMessage} friendlyError={friendlyError} />;
      case 'audit': return <AuditPanel api={api} />;
      case 'inbox': return <InboxPanel api={api} workspace={workspace} />;
      case 'software': return <SoftwarePanel api={api} workspace={workspace} inventory={inventory} software={software} softwareResults={softwareResults} checkSoftware={checkSoftware} previewSoftwareLocation={previewSoftwareLocation} previewSoftware={previewSoftware} previewSoftwareImport={previewSoftwareImport} previewSoftwareRecipe={previewSoftwareRecipe} previewSoftwareRevert={previewSoftwareRevert} previewSoftwareConnectorLaunch={previewSoftwareConnectorLaunch} setMessage={setMessage} setPlanPreview={setPlanPreview} setPlanPayload={setPlanPayload} />;
      case 'git': return <GitPanel gitDetails={gitDetails} workspace={workspace} refreshGit={refreshGit} previewGit={previewGit} sensitiveScan={sensitiveScan} />;
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
        <PlanPreview planPreview={planPreview} executePlan={executePlan} closePlan={() => { setPlanPreview(null); setPlanPayload(null); }} planWriteKinds={PLAN_WRITE_KINDS} />
      </section>
    </main>
  );
}

