export function requestCoordinator(initialSession=null) {
  let session=initialSession,sequence=0;const requests=new Map();
  return {
    updateSession(value){if(value!==session){session=value;requests.clear();sequence++;}},
    begin(key){const captured=session,id=++sequence;requests.set(key,id);return {current:()=>captured===session && requests.get(key)===id,assert(){if(!this.current())throw Error('STALE_TASK_RESULT');}};},
    invalidate(key){requests.delete(key);}
  };
}
export function scopedContext(context,scope) {
  const result={...context};
  for(const [name,value] of Object.entries(context))if(name.startsWith('set') && typeof value==='function')result[name]=(...args)=>{if(scope.current())return value(...args);};
  result.api=Object.fromEntries(Object.entries(context.api).map(([name,method])=>[name,(...args)=>{
    scope.assert();const output=method(...args);if(output?.then)return output.then(value=>{scope.assert();return value;});return output;
  }]));return result;
}
