// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    refreshGit:async (context)=> {
      const {workspace,setInventory,setMessage,api,setGitDetails,setSensitiveScan,friendlyError}=context;

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
  
    },
    previewGit:async (context, action, fields=null)=> {
      const {workspace,inventory,message,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;

    if (!workspace) return;
    const input = { workspaceRoot: workspace, action };
    if(!fields) {setMessage('请填写当前仓库操作表单，再生成计划。');return;}
    Object.assign(input,fields);
    if(action==='backup')input.backupMode='history';
    if(action==='snapshot'){input.action='backup';input.backupMode='snapshot';}
    try {
      const plan = await api.previewGitPlan(input);
      setPlanPreview(plan);
      setPlanPayload(null);
      setMessage(`已生成 Git ${action} 计划。尚未执行任何 Git 命令。`);
    } catch (error) {
      setMessage(`Git 计划被拒绝：${friendlyError(error)}`);
    }
  
    },
  };
}
