import {useScopedState} from '../../shared/useScopedState.mjs';
export function useFeatureState(workspaceSession) {
  const [softwareResults, setSoftwareResults] = useScopedState(workspaceSession,{});
  return {softwareResults,setSoftwareResults};
}
