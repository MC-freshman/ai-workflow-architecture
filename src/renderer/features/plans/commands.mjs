// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    executePlan:async (context)=> {
      const {workspace,setInventory,setBusy,message,setMessage,api,planPreview,setPlanPreview,planPayload,setPlanPayload,setTransactionProgress,setGitDetails,setTargetVersions,integrationTargetId,integrationPath,setIntegrationTargetVersion,software,reloadIntegrationTarget,inspectAnchor,friendlyError,PLAN_WRITE_KINDS}=context;

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
      if (planPreview.kind === 'platform-onboarding' && !['complete','configured-pending'].includes(applied.status)) {
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
      if(planPreview.kind==='platform-onboarding' && applied.status==='configured-pending'){setMessage(`本轮配置已保存，架构接入尚未完成。暂缓/待补步骤 ${(applied.pending || []).length} 项，未绑定软件 ${(applied.pendingSoftware || []).length} 项；取消暂缓勾选或补齐后可继续。`);return;}
      if(planPreview.kind==='platform-body') {setMessage(verification.ok?'平台本体安置和真实恢复已通过；'+(applied.nativeStatus==='interface-required'?'原生接口仍待补齐。':'客户端需点击真实入口测试。')+'能力地板、首次认证和入库通过后才算架构接入完成。':'本体回读未通过，请查看接入记录。');return;}
      // Aligning a platform is not the end of the operation: the platform must re-certify itself
      // against the configuration it now has, and that run is what produces the readable evidence.
      if(planPreview.kind==='platform-anchor-alignment') {
        const targetId=planPreview.target.platformId;
        if(!verification.ok){setMessage(`${targetId} 的配置已写入，但回读未通过：${(verification.differences || []).map(difference=>`${difference.key} ${difference.current}→${difference.expected}`).join('；') || '见审计记录'}。请先处理差异再认证。`);return;}
        setMessage(`${targetId} 已对齐到锚定代，正在用该平台自己的配置补跑受影响格与能力地板检查。`);
        setTransactionProgress({phase:`${targetId} 对齐后认证`,state:'running'});
        try {
          const certified=await api.checkAfterAnchorAlignment({ workspaceRoot: workspace, platformId: targetId, anchorDigestSha256: planPreview.target.anchorDigest });
          const counts=certified.firstCertification?.counts || certified.steps?.find(step=>step.step==='post-alignment-check')?.result?.counts || null;
          if(certified.status==='failed'||certified.status==='cancelled'){setMessage(`${targetId} 对齐完成，但认证停在 ${certified.stoppedAt || '检查步骤'}：${friendlyError(new Error(certified.error || '检查未通过'))}。配置已生效；修正后可再点“检查受影响调用”。`);}
          else if(certified.firstCertification){setMessage(`${targetId} 对齐并完成首次认证：矩阵 ${counts?.pass ?? '?'} 通过 / ${counts?.fail ?? '?'} 失败，证据哈希已固化。`);}
          else {setMessage(`${targetId} 对齐完成；本轮检查未产生可固化的首次认证（记录状态 ${certified.status}），证据路径见接入记录。`);}
        } catch (error) {
          setMessage(`${targetId} 配置已对齐，但自动认证未能执行：${friendlyError(error)}。可在“平台与接入”里手动点击“检查受影响调用”。`);
        } finally { setTransactionProgress(null); }
        try { await inspectAnchor(); } catch { /* the alignment itself already succeeded */ }
        return;
      }
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
