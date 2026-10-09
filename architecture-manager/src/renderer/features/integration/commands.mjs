// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    reloadIntegrationTarget:async (context)=> {
      const {workspace,setMessage,api,integrationKind,integrationTargetId,integrationPath,setIntegrationTarget,setIntegrationText,setPlatformSuggestion,friendlyError}=context;

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
  
    },
    previewIntegration:async (context)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,integrationKind,integrationTargetId,integrationMode,integrationPath,integrationTarget,integrationText,integrationTargetVersion,resources,friendlyError}=context;

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
  
    },
  };
}
