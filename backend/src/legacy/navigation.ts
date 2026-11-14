import { record, object, string } from '../decode.ts';
import { PathError } from '../files/service.ts';
import { decodeSymbols } from '../symbols/decode.ts';
import type { GitState } from '../index/types.ts';
export function gitState(value: unknown): GitState {
  const v = record(value);
  if (typeof v.git !== 'boolean') throw new Error('invalid git payload');
  const textMap = (value: unknown): Record<string, string> => {
    if (value === null || value === undefined) return {};
    return Object.fromEntries(Object.entries(record(value)).map(([k, v]) => [k, string(v)]));
  };
  const boolMap = (value: unknown): Record<string, boolean> => {
    if (value === null || value === undefined) return {};
    return Object.fromEntries(
      Object.entries(record(value)).map(([k, v]) => {
        if (typeof v !== 'boolean') throw new Error('invalid git flag');
        return [k, v];
      }),
    );
  };
  return {
    git: v.git,
    statuses: textMap(v.statuses),
    staged: boolMap(v.staged),
    partial: boolMap(v.partial),
    yourStatuses: textMap(v.yourStatuses),
  };
}
export class LegacyNavigation {
  private snapshot: Record<string, unknown> = {};
  private controller = new AbortController();
  private task: Promise<void> | undefined;
  private updating: Promise<void> = Promise.resolve();
  private agentWrites = false;
  constructor(
    readonly options: {
      origin: string;
      base: string;
      apply: (state: GitState) => Promise<void>;
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
  async refresh(): Promise<GitState> {
    while (true) {
      await this.updateMeta();
      if (this.snapshot.ready === true) break;
      await Bun.sleep(5);
      this.controller.signal.throwIfAborted();
    }
    const state = gitState(await this.value('api/git/refresh'));
    return state;
  }
  private apply(state: GitState): Promise<void> {
    this.updating = this.updating.catch(() => undefined).then(() => this.options.apply(state));
    return this.updating;
  }
  start(): void {
    if (this.task) return;
    this.task = this.subscribe();
    void this.task.catch((error) => {
      if (!this.controller.signal.aborted)
        process.stderr.write('faah legacy stream: ' + String(error) + '\n');
    });
  }
  private async subscribe(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const response = await fetch(this.options.origin + this.options.base + 'api/git/stream', {
          headers: { Accept: 'text/event-stream' },
          signal: this.controller.signal,
        });
        if (!response.ok) throw new Error('legacy stream: HTTP ' + response.status);
        if (!response.body) throw new Error('legacy stream has no body');
        let buffer = '';
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let end = buffer.indexOf('\n\n');
            while (end >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const event = frame
                .split('\n')
                .find((l) => l.startsWith('event:'))
                ?.slice(6)
                .trim();
              if (event === 'git-status') {
                const text = frame
                  .split('\n')
                  .filter((l) => l.startsWith('data:'))
                  .map((l) => l.slice(5).trimStart())
                  .join('\n');
                const value: unknown = JSON.parse(text);
                await this.apply(gitState(value));
                if (this.agentWrites) await this.options.rebuild();
              }
              end = buffer.indexOf('\n\n');
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } catch (error) {
        if (this.controller.signal.aborted) return;
        process.stderr.write('faah reconnecting legacy Git stream: ' + String(error) + '\n');
      }
      await Bun.sleep(1000);
    }
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
    const value = record(await this.value('api/lsp/setup?path=' + encodeURIComponent(path)));
    return {
      state: string(value.state),
      server: value.state === 'failed' ? string(value.reason) : string(value.server),
    };
  }
  async after(options: { route: string; response: Response; path?: string }): Promise<void> {
    const { route, response, path } = options;
    if (route === 'api/git/refresh' || gitMutations.has(route)) {
      const value: unknown = await response
        .clone()
        .json()
        .catch(() => undefined);
      if (object(value) && typeof value.git === 'boolean' && 'statuses' in value)
        await this.apply(gitState(value));
      else await this.apply(await this.refresh());
      if (gitFileMutations.has(route)) await this.options.rebuild();
    }
    if (!response.ok) return;
    if (route === 'api/file/save' || route === 'api/fs/new') {
      if (path) await this.options.touch(path);
      await this.apply(await this.refresh());
    }
    if (fileMutations.has(route)) {
      this.agentWrites = true;
      await this.options.rebuild();
      await this.apply(await this.refresh());
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
    await this.task?.catch(() => undefined);
    await this.updating;
  }
}
export const gitMutations = new Set([
  'api/git/stage',
  'api/git/unstage',
  'api/git/hunk',
  'api/git/commit',
  'api/git/push',
  'api/git/pull',
  'api/git/sync-agent',
  'api/git/abort',
]);
export const gitFileMutations = new Set([
  'api/git/hunk',
  'api/git/pull',
  'api/git/sync-agent',
  'api/git/abort',
]);
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
