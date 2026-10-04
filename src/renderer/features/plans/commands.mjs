// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    executePlan:async (context)=> {
      const {workspace,setInventory,setBusy,message,setMessage,api,planPreview,setPlanPreview,planPayload,setPlanPayload,setTransactionProgress,setGitDetails,setTargetVersions,integrationTargetId,integrationPath,setIntegrationTargetVersion,software,reloadIntegrationTarget,friendlyError,PLAN_WRITE_KINDS}=context;

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
      if(planPreview.kind==='software-command') {setMessage(applied.reply?.ok?'连接器已返回真实结果：'+(applied.reply.state || planPreview.target.capability)+'；这是本次调用／存活读数。':(applied.reply?.error?.named?.nativeCallMayHaveRun?'功能可能已经执行，返回结果未能确认；请先核实，勿重复提交：':'连接器未完成本次操作：')+friendlyError(applied.reply?.error?.code || 'SOFTWARE_CONNECTOR_FAILED'));return;}
setMessage(planPreview.kind === 'software-launch' ? `连接器答复：${applied.connectorStatus}。${applied.connectorReply?.error?.message || ''}启动只在连接器明确返回存活会话时成立。` : planPreview.kind === 'software-import' ? `软件本体安置与恢复演练${verification.ok ? '通过' : '未通过'}；尚未发布配方，也未接入连接器。` : planPreview.kind === 'software-recipe-publish' ? applied.status === 'published-version-only' && verification.ok ? `版本查询已发布，连接器健康检查和单格认证均通过；其它功能尚需适配。` : `配方文件${verification.ok ? '已发布' : '回读失败'}，但软件仍待验证：${applied.check?.issues?.join('；') || '缺少健康检查结果'}。` : planPreview.kind === 'software-revert' ? `软件撤销/停用${verification.ok ? '已验证' : '验证未通过'}；${applied.releaseRetained ? '已发布版本按只读规则保留。' : '备份保留，本体已移入垃圾桶。'}` : `计划已${applied.status === 'already-applied' ? '确认已执行' : '执行'}，验证${verification.ok ? '通过' : '未通过'}。`);
    } catch (error) {
      setMessage(`计划执行失败：${friendlyError(error)}`);
    } finally {
      setBusy(false);
      setTransactionProgress(null);
    }
  
    },
  };
}
