import {useScopedState} from '../../shared/useScopedState.mjs';
export function useFeatureState(workspaceSession) {
  const [gitDetails, setGitDetails] = useScopedState(workspaceSession,null);
  const [sensitiveScan, setSensitiveScan] = useScopedState(workspaceSession,null);
  return {gitDetails,setGitDetails,sensitiveScan,setSensitiveScan};
}
