import { extname } from 'node:path';
import { record, string } from '../decode.ts';
import { PathError } from '../files/service.ts';
import { decodeSymbols } from '../symbols/decode.ts';
export class LegacyNavigation {
  private snapshot: Record<string, unknown> = {};
  private controller = new AbortController();
  constructor(
    readonly options: {
      origin: string;
      base: string;
      refresh: () => Promise<void>;
      rebuild: () => Promise<void>;
      touch: (path: string) => Promise<void>;
    },
  ) {}
  async value(route: string): Promise<unknown> {
    const response = await fetch(this.options.origin + this.options.base + route, {
      signal: this.controller.signal,
    });
    if (!response.ok) throw new Error('legacy ' + route + ': HTTP ' + response.status);
    const value: unknown = await response.json();
    return value;
  }
  async meta(): Promise<Record<string, unknown>> {
    await this.updateMeta();
    return this.snapshot;
  }
  async updateMeta(): Promise<void> {
    this.snapshot = record(await this.value('api/meta'));
  }
  async refreshAndApply(): Promise<void> {
    await this.options.refresh();
  }
  async outline(path: string) {
    const response = await fetch(
      this.options.origin + this.options.base + 'api/outline?path=' + encodeURIComponent(path),
      { signal: this.controller.signal },
    );
    const value = record(await response.json());
    if (!response.ok) throw new PathError(response.status, string(value.error));
    return { path: string(value.path), symbols: decodeSymbols(value.symbols) };
  }
  async lsp(path: string): Promise<{ state: string; server: string }> {
    // Go State uses only the extension, without resolvePath's containment check.
    const value = record(
      await this.value('api/lsp/setup?path=' + encodeURIComponent('state' + extname(path))),
    );
    return {
      state: string(value.state),
      server: value.state === 'failed' ? string(value.reason) : string(value.server),
    };
  }
  async after(options: {
    route: string;
    response: Response;
    path?: string;
    method?: string;
  }): Promise<void> {
    const { route, response, path } = options;
    // Proxied writers may change the tree even when their operation fails.
    if (route === 'api/git/commit-message' || route === 'api/git/sync-agent') {
      if (route === 'api/git/sync-agent') await this.options.rebuild();
      await this.options.refresh();
    }
    if (fileMutations.has(route)) {
      await this.options.rebuild();
      await this.options.refresh();
    }
    if (!response.ok) return;
    if (route === 'api/file/save' || route === 'api/fs/new') {
      if (path) await this.options.touch(path);
      await this.options.refresh();
    }
    if (route === 'api/review-workflow/config' && options.method === 'POST') {
      await this.options.touch('.faah/workflows.json');
      await this.options.refresh();
    }
    if (
      route.startsWith('api/lsp/') ||
      route.startsWith('api/agent/') ||
      route.startsWith('api/threads/')
    )
      await this.updateMeta();
  }
  async close(): Promise<void> {
    this.controller.abort();
  }
}
export const fileMutations = new Set([
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
