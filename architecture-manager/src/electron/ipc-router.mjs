import { operationRegistrar } from './operation-registry.mjs';
import { runDomainTask } from '../infrastructure/tasks.mjs';
import { taskContext } from '../app/task-context.mjs';

function backendArguments(style, input, args) {
  switch (style) {
    case 'document': return [input.workspaceRoot, input.relativePath];
    case 'references': return [input.workspaceRoot, input.repository, input.resourceId];
    case 'health': return [input.workspaceRoot, input.softwareId, input.platformId];
    case 'clone': return [{plan: input.plan}];
    case 'native-status': return [input.workspaceRoot, input.platformId];
    default: return args;
  }
}

export function createOperationRouter({ipcMain, lifecycle, rememberWorkspace, runTask = runDomainTask}) {
  return operationRegistrar(ipcMain, {dispatch: ({declaration, event, args, handler}) => {
    const metadata = args.at(-1)?.__managerTaskContext ? args.pop() : {};
    const input = args[0];
    if (!declaration.backend) return handler(event, ...args);
    const {workspaceRoot, platformId} = taskContext(input);
    const mode = input?.plan?.kind === 'software-launch' ||
      input?.plan?.kind === 'software-command' && input.plan.target.operation === 'open'
      ? 'provider-session' : declaration.taskMode;
    return lifecycle.track(async () => {
      const result = await runTask({method: declaration.backend,
        args: backendArguments(declaration.argumentsStyle, input, args),
        workspaceRoot, platformId, jobId: metadata.jobId, workspaceSession: metadata.workspaceSession,
        mode, phase: declaration.phase,
        onProgress: progress => event.sender.send('transaction:progress', progress)});
      if (declaration.backend === 'scanWorkspace') rememberWorkspace(result.workspaceRoot);
      return result;
    });
  }});
}
