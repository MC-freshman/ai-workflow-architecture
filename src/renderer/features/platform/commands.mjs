// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    previewPlatform:async (context, platform)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

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
  
    },
    checkPlatform:async (context, platform, mode)=> {
      const {workspace,setInventory,setBusy,setMessage,api,setTransactionProgress,friendlyError}=context;

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
  
    },
    addPlatformDirectory:async (context)=> {
      const {workspace,inventory,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

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
  
    },
  };
}
