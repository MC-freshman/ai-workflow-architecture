import {useScopedState} from '../../shared/useScopedState.mjs';
export function useFeatureState(workspaceSession) {
  const [integrationKind, setIntegrationKind] = useScopedState(workspaceSession,'platform');
  const [integrationTargetId, setIntegrationTargetId] = useScopedState(workspaceSession,'');
  const [integrationMode, setIntegrationMode] = useScopedState(workspaceSession,'config');
  const [integrationPaths, setIntegrationPaths] = useScopedState(workspaceSession,[]);
  const [integrationPath, setIntegrationPath] = useScopedState(workspaceSession,'');
  const [integrationTarget, setIntegrationTarget] = useScopedState(workspaceSession,null);
  const [integrationText, setIntegrationText] = useScopedState(workspaceSession,'');
  const [integrationTargetVersion, setIntegrationTargetVersion] = useScopedState(workspaceSession,'');
  const [platformSuggestion, setPlatformSuggestion] = useScopedState(workspaceSession,null);
  return {integrationKind,setIntegrationKind,integrationTargetId,setIntegrationTargetId,integrationMode,setIntegrationMode,integrationPaths,setIntegrationPaths,integrationPath,setIntegrationPath,integrationTarget,setIntegrationTarget,integrationText,setIntegrationText,integrationTargetVersion,setIntegrationTargetVersion,platformSuggestion,setPlatformSuggestion};
}
