import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  initialWorkspaceState,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './workspaceReducer';

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Workspace + explorer state (spec §9). Deliberately separate from the
 * editor tabs store: the workspace describes the folder on disk, the tabs
 * describe editor buffers.
 */
export function WorkspaceProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    initialWorkspaceState,
  );
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (context === null) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return context;
}
