import {useEffect,useMemo,useRef} from 'react';
export function useSelectionApi(api,identity) {
  const current=useRef(identity),mounted=useRef(true);current.current=identity;
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  return useMemo(()=>Object.fromEntries(Object.entries(api).map(([name,method])=>[name,(...args)=>{
    const check=()=>{if(!mounted.current || current.current!==identity)throw Error('STALE_TASK_RESULT');};check();const result=method(...args);return result?.then?result.then(value=>{check();return value;}):result;
  }])),[api,identity]);
}
