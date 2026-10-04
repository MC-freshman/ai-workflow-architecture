import {useScopedState} from '../../shared/useScopedState.mjs';
export function useFeatureState(workspaceSession) {
  const [catalogDetail, setCatalogDetail] = useScopedState(workspaceSession,null);
  const [catalogFilter, setCatalogFilter] = useScopedState(workspaceSession,'');
  const [skillDetail, setSkillDetail] = useScopedState(workspaceSession,null);
  const [skillFilter, setSkillFilter] = useScopedState(workspaceSession,'');
  const [resourceFilter, setResourceFilter] = useScopedState(workspaceSession,'');
  const [targetVersions, setTargetVersions] = useScopedState(workspaceSession,{});
  return {catalogDetail,setCatalogDetail,catalogFilter,setCatalogFilter,skillDetail,setSkillDetail,skillFilter,setSkillFilter,resourceFilter,setResourceFilter,targetVersions,setTargetVersions};
}
