import { useScopedState } from './useScopedState.mjs';
export function usePlanState(session) {
  const [planPreview,setPlanPreview] = useScopedState(session,null);
  const [planPayload,setPlanPayload] = useScopedState(session,null);
  return { planPreview,setPlanPreview,planPayload,setPlanPayload };
}
