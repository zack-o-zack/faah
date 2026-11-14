import type { ReviewDraft, SessionUpdate, WorkspaceSession } from './model.ts';

export interface SessionStorage {
  get(key: string): WorkspaceSession;
  update(key: string, change: (session: WorkspaceSession) => void): WorkspaceSession;
}

/** Owns UI state and review drafts for one stable workspace identity, independently of its checkout. */
export class Session {
  constructor(private readonly options: { store: SessionStorage; key: string }) {}

  get(): WorkspaceSession {
    return this.options.store.get(this.options.key);
  }

  update(update: SessionUpdate): WorkspaceSession {
    return this.options.store.update(this.options.key, (session) => Object.assign(session, update));
  }

  drafts(drafts: ReviewDraft[]): WorkspaceSession {
    return this.options.store.update(this.options.key, (session) => {
      session.drafts = drafts;
    });
  }
}
