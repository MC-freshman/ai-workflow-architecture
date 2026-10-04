import {useRef} from 'react';
import {requestCoordinator,scopedContext} from './request-coordinator.mjs';
import {createCommands as workspaceCommands} from '../features/workspace/commands.mjs';
import {createCommands as gitCommands} from '../features/git/commands.mjs';
import {createCommands as integrationCommands} from '../features/integration/commands.mjs';
import {createCommands as platformCommands} from '../features/platform/commands.mjs';
import {createCommands as resourcesCommands} from '../features/resources/commands.mjs';
import {createCommands as documentsCommands} from '../features/documents/commands.mjs';
import {createCommands as softwareCommands} from '../features/software/commands.mjs';
import {createCommands as plansCommands} from '../features/plans/commands.mjs';
export function useDomainCommands(modelRef,session) {
  const control=useRef(null),commands=useRef(null);control.current ||=requestCoordinator(session);control.current.updateSession(session);
  if(!commands.current) {
    const groups={workspace:workspaceCommands(),git:gitCommands(),integration:integrationCommands(),platform:platformCommands(),resources:resourcesCommands(),documents:documentsCommands(),software:softwareCommands(),plans:plansCommands()};
    commands.current=Object.fromEntries(Object.entries(groups).flatMap(([group,methods])=>Object.entries(methods).map(([name,method])=>[name,async(...args)=>{
      const key=name.startsWith('preview') || name==='executePlan'?'plan-surface':group,scope=control.current.begin(key),snapshot=modelRef.current;
      if(group==='integration') {const current=scope.current;scope.current=()=>current() && ['integrationKind','integrationTargetId','integrationMode','integrationPath'].every(field=>snapshot[field]===modelRef.current[field]);}
      try{return await method(scopedContext(modelRef.current,scope),...args);}catch(error){if(error.message!=='STALE_TASK_RESULT')throw error;}
    }])));
  }
  return commands.current;
}
