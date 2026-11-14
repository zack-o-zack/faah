import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Index } from '../index/service.ts';
import { dirtyPaths } from '../index/git.ts';
import { compare } from '../text.ts';
import { GitCommands } from './commands.ts';
import { GitStatus } from './status.ts';
import { GitHistory } from './history.ts';
import { GitLinks } from './links.ts';
import { GitSync } from './sync.ts';
import type { GitCommit } from './history-parser.ts';
import { dictionary } from './maps.ts';

export interface GitPayload {
  git: boolean;
  gitChanges: number;
  gitFiles: string[] | null;
  statuses: Record<string, string> | null;
  dirtyDirs?: Record<string, boolean>;
  staged?: Record<string, boolean>;
  partial?: Record<string, boolean>;
  yourStatuses?: Record<string, string>;
  yourDirtyDirs?: Record<string, boolean>;
  branch?: string;
  recentCommits?: GitCommit[];
  commitsUrl?: string;
  ahead: number;
  behind: number;
}
function flags(paths: Set<string>): Record<string, boolean> {
  const out = dictionary<boolean>();
  for (const path of paths) out[path] = true;
  return out;
}
function nonempty<T>(map: Record<string, T>): Record<string, T> | undefined {
  return Object.keys(map).length ? map : undefined;
}
// Dates and commitsUrl do not participate in Go's changed-payload decision.
function identity(payload: GitPayload): string {
  const map = (value: Record<string, unknown> | null | undefined) =>
    Object.entries(value ?? {}).sort(([a], [b]) => compare(a, b));
  return JSON.stringify([
    payload.git,
    map(payload.statuses),
    map(payload.staged),
    map(payload.partial),
    map(payload.yourStatuses),
    payload.recentCommits?.[0]?.hash ?? '',
    payload.branch ?? '',
    payload.ahead,
    payload.behind,
  ]);
}
export class GitWorkspace {
  private readonly status: GitStatus;
  private readonly history: GitHistory;
  private readonly links: GitLinks;
  readonly sync: GitSync;
  private dirty = true;
  private metaDirty = true;
  private lastReady = false;
  private payload: GitPayload | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly clients = new Set<(payload: GitPayload) => void>();
  private closed = false;
  private fallback = false;
  private metaTimer: ReturnType<typeof setInterval> | undefined;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private fingerprint: string | undefined;
  private streak = 0;
  constructor(
    readonly index: Index,
    readonly commands: GitCommands,
  ) {
    this.status = new GitStatus(commands.probe);
    this.history = new GitHistory(commands);
    this.links = new GitLinks(commands);
    this.sync = new GitSync(commands);
  }
  private queue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.catch(() => undefined);
    return result;
  }
  ensure(): Promise<GitPayload> {
    return this.queue(async () => {
      // Without filesystem observation, each read must obtain a fresh snapshot.
      if (this.fallback) this.invalidate(true);
      if (!this.payload || this.dirty || this.metaDirty || this.lastReady !== this.index.ready)
        return (await this.update()).payload;
      return this.payload;
    });
  }
  refresh(): Promise<GitPayload> {
    this.invalidate(true);
    return this.ensure();
  }
  invalidate(metadata = false): void {
    this.dirty = true;
    this.metaDirty ||= metadata;
  }
  changed(metadata = false): Promise<void> {
    this.invalidate(metadata);
    this.streak = 0;
    if (metadata && this.fallback && this.clients.size && !this.closed) {
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.scheduleStatus(1000);
    }
    return this.clients.size ? this.ensure().then(() => undefined) : Promise.resolve();
  }
  private async update(): Promise<{ payload: GitPayload; changed: boolean }> {
    const ready = this.index.ready;
    const metadata = this.metaDirty || !this.payload || this.lastReady !== ready;
    // Capture invalidations before awaiting Git: a later event must survive this refresh.
    this.dirty = this.metaDirty = false;
    const state = ready ? await this.status.read(this.index.root) : this.index.git;
    if (ready && !this.closed) await this.index.applyGit(state);
    const git = Boolean(await this.commands.probe.get(this.index.root));
    let branch = this.payload?.branch ?? '',
      recent = this.payload?.recentCommits ?? [],
      commitsUrl = this.payload?.commitsUrl ?? '',
      ahead = this.payload?.ahead ?? 0,
      behind = this.payload?.behind ?? 0;
    if (metadata || this.payload?.git !== git) {
      branch = '';
      recent = [];
      commitsUrl = '';
      ahead = behind = 0;
      if (git) {
        [branch, recent] = await Promise.all([
          this.sync.branch(this.index.root),
          this.history.recent(this.index.root, 5),
        ]);
        const [url, counts] = await Promise.all([
          this.links.commits(this.index.root, branch),
          this.sync.aheadBehind(this.index.root),
        ]);
        commitsUrl = url;
        ahead = counts.ahead;
        behind = counts.behind;
      }
    }
    const populated = ready && git;
    const payload: GitPayload = {
      git,
      gitChanges: populated ? this.index.gitFiles.length : 0,
      gitFiles: populated ? this.index.gitFiles : null,
      statuses: populated ? state.statuses : null,
      dirtyDirs: populated ? nonempty(flags(dirtyPaths(state.statuses))) : undefined,
      staged: populated ? nonempty(state.staged) : undefined,
      partial: populated ? nonempty(state.partial) : undefined,
      yourStatuses: populated ? nonempty(state.yourStatuses) : undefined,
      yourDirtyDirs: populated ? nonempty(flags(dirtyPaths(state.yourStatuses))) : undefined,
      branch: branch || undefined,
      recentCommits: recent.length ? recent : undefined,
      commitsUrl: commitsUrl || undefined,
      ahead,
      behind,
    };
    const changed =
      !this.payload || this.lastReady !== ready || identity(payload) !== identity(this.payload);
    this.payload = payload;
    this.lastReady = ready;
    if (changed && !this.closed) for (const client of this.clients) client(payload);
    return { payload, changed };
  }
  async subscribe(send: (payload: GitPayload) => void): Promise<() => void> {
    // Refresh before registering so a new client receives exactly one snapshot.
    const payload = await this.refresh();
    if (this.closed) return () => {};
    this.clients.add(send);
    send(
      payload.git
        ? payload
        : { git: false, gitChanges: 0, gitFiles: [], statuses: {}, ahead: 0, behind: 0 },
    );
    this.polling();
    return () => {
      this.clients.delete(send);
      this.polling();
    };
  }
  watching(available: boolean): void {
    this.fallback = !available;
    this.polling();
  }
  private polling(): void {
    const needed = this.fallback && this.clients.size > 0 && !this.closed;
    if (!needed) {
      if (this.metaTimer) clearInterval(this.metaTimer);
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.metaTimer = this.statusTimer = undefined;
      return;
    }
    if (!this.metaTimer)
      this.metaTimer = setInterval(() => {
        void this.pollMeta();
      }, 1000);
    if (!this.statusTimer) this.scheduleStatus(1000);
  }
  private async pollMeta(): Promise<void> {
    try {
      const info = await this.commands.probe.get(this.index.root);
      if (!info || this.closed) return;
      const head = await readFile(join(info.dir, 'HEAD'), 'utf8').catch(() => '');
      const ref = head.startsWith('ref: ') ? head.slice(5).trim() : '';
      const paths = [
        'index',
        'HEAD',
        'logs/HEAD',
        'packed-refs',
        'FETCH_HEAD',
        'MERGE_HEAD',
        'rebase-merge',
        'rebase-apply',
        ...(ref ? [ref] : []),
      ];
      const times = await Promise.all(
        paths.map(async (path) => {
          const s = await stat(join(info.dir, path)).catch(() => undefined);
          return s ? [path, s.mtimeMs, s.size] : [path];
        }),
      );
      const fingerprint = JSON.stringify(times);
      if (this.fingerprint !== fingerprint) {
        this.fingerprint = fingerprint;
        await this.changed(true);
      }
    } catch {
      /* A closing or disappearing repository is retried on demand. */
    }
  }
  private scheduleStatus(delay: number): void {
    this.statusTimer = setTimeout(() => {
      void this.pollStatus();
    }, delay);
  }
  private async pollStatus(): Promise<void> {
    const start = performance.now();
    let changed = false;
    try {
      const result = await this.queue(() => this.update());
      changed = result.changed;
    } catch {
      // A transient filesystem error must not escape the polling task.
    } finally {
      this.streak = changed ? 0 : Math.min(4, this.streak + 1);
      this.statusTimer = undefined;
      if (this.fallback && this.clients.size && !this.closed)
        this.scheduleStatus(
          Math.min(10000, Math.max(1000, (performance.now() - start) * 5, 2 ** this.streak * 1000)),
        );
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.clients.clear();
    this.polling();
    await this.pending;
  }
}
