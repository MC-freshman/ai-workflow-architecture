// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    checkSoftware:async (context, item, platformId)=> {
      const {workspace,setBusy,setMessage,api,setTransactionProgress,setSoftwareResults,friendlyError}=context;

    setBusy(true);
    try {
      const result = await api.softwareHealth({ workspaceRoot: workspace, softwareId: item.id,platformId });
      setSoftwareResults((state) => ({ ...state, [platformId+'/'+item.id]: result }));
      setMessage(`${platformId}/${item.id} 健康检查：${result.description || result.status}`);
    } catch (error) {
      setMessage(`软件健康检查失败：${friendlyError(error)}`);
    } finally {setBusy(false);setTransactionProgress(null);}
  
    },
    previewSoftware:async (context, item)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, mode: 'launch' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已列出 ${item.id} 的启动条件。当前管理台没有启动执行器，未启动软件。`);
    } catch (error) {
      setMessage(`软件启动计划被拒绝：${friendlyError(error)}`);
    }
  
    },
    previewSoftwareImport:async (context, selection)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    try {
      const plan = await api.previewSoftwareImportPlan({ workspaceRoot: workspace, ...selection });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(`已生成 ${selection.softwareId} 安置与备份计划：${plan.rows.length} 个文件，预计新增 ${Math.ceil((plan.estimatedAdditionalBytes || 0) / 1024 / 1024)} MiB（备份 + 本体，不含原下载文件）；尚未复制。`);
    } catch (error) { setMessage(`软件安置计划被拒绝：${friendlyError(error)}`); }
  
    },
    previewSoftwareRecipe:async (context, selection)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    if (!await api.confirm(`确认只读询问 ${selection.softwareId} 的版本？\n\n管理台会启动你选定的程序并传入 ${selection.versionFlag}；程序本身仍可能有副作用。请仅对可信软件继续。`)) return;
    try {
      const plan = await api.previewSoftwareRecipePlan({ workspaceRoot: workspace, ...selection });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(`已从真实程序取得版本输出并生成配方计划；尚未发布，且只声明“版本查询”能力。`);
    } catch (error) { setMessage(`配方计划被拒绝：${friendlyError(error)}`); }
  
    },
    previewSoftwareLocation:async (context, item, platformId)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    try {
      const plan = await api.previewSoftwarePlan({ workspaceRoot: workspace, softwareId: item.id, platformId, mode: 'open-location' });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成打开 ${item.id} 本体目录的计划，确认后才会打开资源管理器。`);
    } catch (error) {
      setMessage(`软件位置计划被拒绝：${friendlyError(error)}`);
    }
  
    },
    previewSoftwareConnectorLaunch:async (context, item, platformId)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    if (!workspace || !platformId) return;
    try {
      const plan = await api.previewSoftwareConnectorLaunchPlan({ workspaceRoot: workspace, platformId, softwareId: item.id });
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 ${item.id} 经 ${platformId} 连接器的启动计划；连接器的答复会原样转达（含 INTERACTIVE_REQUIRED / 漂移），不会美化。`);
    } catch (error) {
      setMessage(`启动计划被拒绝：${friendlyError(error)}`);
    }
  
    },
    previewSoftwareRevert:async (context, item)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,software,friendlyError}=context;

    try {
      const plan = await api.previewSoftwareRevertPlan({ workspaceRoot: workspace, checkpointPath: item.checkpointPath });
      setPlanPreview(plan); setPlanPayload(null);
      setMessage(item.action === 'software-import' ? '已生成撤销安置计划：本体将移入 inbox/trash，备份保留。' : '已生成停用发布计划：解除连接器绑定并停用 registry 条目，已发布版本保留。');
    } catch (error) { setMessage(`软件撤销计划被拒绝：${friendlyError(error)}`); }
  
    },
  };
}
