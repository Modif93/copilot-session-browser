import { Session, WorkspaceInfo } from '../models/types';

/** Keep real projects and anonymous storage folders that have loaded sessions. */
export function visibleWorkspaces(workspaces: WorkspaceInfo[], sessions: Session[]): WorkspaceInfo[] {
  const contexts = new Set(sessions.filter(s => s.messageCount > 0)
    .map(s => (s.workspaceContext || '').toLowerCase()));
  return workspaces.filter(w => w.folderPath.trim() !== '' || (w.hash !== '' && contexts.has(w.hash.toLowerCase())));
}
