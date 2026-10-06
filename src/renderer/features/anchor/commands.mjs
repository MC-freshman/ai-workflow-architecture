// Anchor commands: read the anchored generation, preview materialising it, and preview the alignment
// of one platform. Every preview only prepares a plan; the write happens through the shared plan
// preview and its confirmation, exactly like every other transaction in this manager.
export function createCommands() {
  return {
    inspectAnchor:async (context)=> {
      const {workspace,setMessage,api,setAnchorReport,friendlyError}=context;
      if(!workspace){setMessage('请先选择工作区。');return;}
      try {
        const report=await api.readAnchorReport({ workspaceRoot: workspace });
        setAnchorReport(report);
        if(report.refusal){
          setMessage(`锚定代尚不可用：${report.refusal.code}。下方列出每个候选版本落选的原因。`);
          return;
        }
        const behind=report.platforms.filter((row)=>row.ok && !row.anchor.aligned).length;
        setMessage(report.materialised
          ? `锚定代已物化（${report.computedDigest?.slice(0,12)}…）；${behind} 个平台与它不一致。`
          : `锚定代尚未落盘：引擎 ${report.anchor.engine.version} / 契约 ${report.anchor.contracts.version} / 检查器 ${report.anchor.checker.version} / 判据 ${report.anchor.judge.version}。可先生成锚定件。`);
      } catch (error) {
        setMessage(`读取锚定代失败：${friendlyError(error)}`);
      }
    },
    previewAnchor:async (context)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;
      if(!workspace){setMessage('请先选择工作区。');return;}
      try {
        const plan=await api.previewAnchorPlan({ workspaceRoot: workspace });
        if(plan.changed===false){setMessage('锚定件与当前工作区逐字一致，无需写入。');return;}
        setPlanPreview(plan);setPlanPayload(null);
        setMessage(`已生成锚定件计划（${plan.steps?.length || 0} 项写入），尚未落盘。`);
      } catch (error) {
        setMessage(`锚定件计划被拒绝：${friendlyError(error)}`);
      }
    },
    previewAnchorAlignment:async (context, platformId)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,friendlyError}=context;
      if(!workspace){setMessage('请先选择工作区。');return;}
      try {
        const plan=await api.previewAnchorAlignmentPlan({ workspaceRoot: workspace, platformId });
        if(plan.changed===false){setMessage(`${platformId} 已经在锚定代上，无需改动。`);return;}
        setPlanPreview(plan);setPlanPayload(null);
        const warnings=plan.payload?.warnings?.length || 0;
        setMessage(`已生成 ${platformId} 的对齐计划：将写 ${plan.payload?.files?.length || 0} 个文件${warnings?`，并记录 ${warnings} 条具名警告`:''}。尚未写入。`);
      } catch (error) {
        setMessage(`${platformId} 的对齐计划被拒绝：${friendlyError(error)}`);
      }
    },
  };
}
