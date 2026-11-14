/** Writers that run in Go and may change the tree even when they fail. */
const treeWriters = new Set([
  'api/agent/edit',
  'api/agent/batch',
  'api/agent/job',
  'api/agent/cancel',
  'api/threads/send',
  'api/threads/cancel',
  'api/threads/revert',
  'api/review-workflow/run',
  'api/review-workflow/status',
  'api/review-workflow/stop',
]);

export interface ConsistencyHooks {
  refreshGit: () => Promise<void>;
  rebuildIndex: () => Promise<void>;
  touch: (path: string) => Promise<void>;
  refreshMeta: () => Promise<void>;
}

/**
 * Keeps Bun's index and Git state current after a proxied Go route ran. Go
 * writes files Bun did not see (agents, threads, review workflows), so the
 * affected caches are rebuilt or refreshed once the response arrives.
 */
export class LegacyConsistency {
  constructor(private readonly hooks: ConsistencyHooks) {}

  async after(route: string, request: Request, response: Response): Promise<void> {
    if (route === 'api/git/commit-message' || route === 'api/git/sync-agent') {
      if (route === 'api/git/sync-agent') await this.hooks.rebuildIndex();
      await this.hooks.refreshGit();
    }
    if (treeWriters.has(route)) {
      await this.hooks.rebuildIndex();
      await this.hooks.refreshGit();
    }
    if (!response.ok) return;
    if (route === 'api/review-workflow/config' && request.method === 'POST') {
      await this.hooks.touch('.faah/workflows.json');
      await this.hooks.refreshGit();
    }
    if (
      route.startsWith('api/lsp/') ||
      route.startsWith('api/agent/') ||
      route.startsWith('api/threads/')
    )
      await this.hooks.refreshMeta();
  }
}
