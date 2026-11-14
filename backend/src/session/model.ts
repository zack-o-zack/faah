export interface SessionTab {
  path: string;
  ref?: string;
}

export interface ReviewDraft {
  id: number;
  path: string;
  line: number;
  side: string;
  body: string;
}

export interface WorkspaceSession {
  tabs: SessionTab[];
  active: number | bigint;
  openDirs: string[];
  drafts?: ReviewDraft[];
}

export type SessionUpdate = Partial<Pick<WorkspaceSession, 'tabs' | 'active' | 'openDirs'>>;
