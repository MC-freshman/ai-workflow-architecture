// Domain commands take a captured workspace context; late results are guarded centrally.
export function createCommands() {
  return {
    openDocument:async (context, path)=> {
      const {workspace,setMessage,api,setSelectedDocument,setDocumentDraft,setSensitiveConfirmed,friendlyError}=context;

    try {
      const document = await api.readDocument({ workspaceRoot: workspace, relativePath: path });
      setSelectedDocument(document);
      setDocumentDraft(document.content);
      setSensitiveConfirmed(false);
      setMessage(`已读取 ${path}，编辑仍只在本地内存中。`);
    } catch (error) {
      setMessage(`文档读取失败：${friendlyError(error)}`);
    }
  
    },
    previewDocument:async (context)=> {
      const {workspace,setMessage,api,setPlanPreview,setPlanPayload,selectedDocument,documentDraft,sensitiveConfirmed,friendlyError}=context;

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
  
    },
  };
}
