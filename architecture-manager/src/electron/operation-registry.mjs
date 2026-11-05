import declarations from '../app/operations.json' with { type: 'json' };
const operationsByChannel = new Map(Object.entries(declarations.operations).map(([method, declaration]) =>
  [declaration.channel, {method, declaration}]));
export function operationRegistrar(ipcMain,{dispatch=null}={}) {
  const registered = new Set();
  return (channel, handler) => {
    if (!operationsByChannel.has(channel) || registered.has(channel)) throw new Error('IPC_OPERATION_UNDECLARED:'+channel);
    registered.add(channel);
    const {method, declaration} = operationsByChannel.get(channel);
    return ipcMain.handle(channel,(event,...args)=>dispatch?dispatch({method,declaration,event,args,handler}):handler(event,...args));
  };
}
