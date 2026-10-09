import React from 'react';
import {useManagerController} from './features/workspace/useManagerController.jsx';
import {WorkspaceScreen} from './features/workspace/WorkspaceScreen.jsx';
export default function App() {
  const model=useManagerController();
  return <WorkspaceScreen key={model.workspaceSession} {...model} />;
}
