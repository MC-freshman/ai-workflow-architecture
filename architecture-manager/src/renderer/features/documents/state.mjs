import {useScopedState} from '../../shared/useScopedState.mjs';
export function useFeatureState(workspaceSession) {
  const [selectedDocument, setSelectedDocument] = useScopedState(workspaceSession,null);
  const [documentDraft, setDocumentDraft] = useScopedState(workspaceSession,'');
  const [sensitiveConfirmed, setSensitiveConfirmed] = useScopedState(workspaceSession,false);
  const [documentFilter, setDocumentFilter] = useScopedState(workspaceSession,'');
  return {selectedDocument,setSelectedDocument,documentDraft,setDocumentDraft,sensitiveConfirmed,setSensitiveConfirmed,documentFilter,setDocumentFilter};
}
