// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    openCatalog:async (context, kind, id)=> {
      const {workspace,setMessage,api,setCatalogDetail,setSkillDetail,setSkillFilter,friendlyError}=context;

    try {
      setCatalogDetail(await api.readCatalogEntry({ workspaceRoot: workspace, kind, id }));
      setSkillDetail(null); setSkillFilter('');
      setMessage(`已打开 ${kind}/${id} 全部内容，可在当前面板下方查看。`);
    } catch (error) {
      setMessage(`读取${kind === 'agent' ? 'agent' : 'skill'}内容失败：${friendlyError(error)}`);
    }
  
    },
    previewRegistryAction:async (context, kind, action, item = null)=> {
      const {workspace,inventory,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

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
  
    },
    previewResource:async (context, resource, selectedVersion = null)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,targetVersions,friendlyError}=context;

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
  
    },
  };
}
