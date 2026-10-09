// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    scan:async (context, root)=> {
      const {setWorkspace,setInventory,setBusy,setMessage,api,setPlanPreview,setPlanPayload,setSelectedDocument,setSoftwareResults,setGitDetails,setCatalogDetail,setSkillDetail,friendlyError}=context;

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
  
    },
  };
}
