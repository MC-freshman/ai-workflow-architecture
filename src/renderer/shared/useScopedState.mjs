import {useMemo,useRef,useState} from 'react';
export function useScopedState(session,initial) {
  const epoch=useRef(session);epoch.current=session;
  const fallback=useMemo(()=>typeof initial==='function'?initial():initial,[session]);
  const [stored,setStored]=useState(()=>({session,value:fallback}));
  const value=stored.session===session?stored.value:fallback;
  return [value,action=>{if(epoch.current!==session)return;setStored(previous=>({session,value:typeof action==='function'?action(previous.session===session?previous.value:fallback):action}));}];
}
