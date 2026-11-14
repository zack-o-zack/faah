import { ServiceError, errorMessage } from '../errors.ts';
import { existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { WorkbenchStore } from './store.ts';
import { dirItem, itemID, type Item } from './store.ts';
import { resolveTarget, detectPR, prURLExamples } from '../cli/target.ts';
import { Child } from '../legacy/child.ts';
import { managedClone, findClone, cloneOf, prepareClone } from './clones.ts';

export interface Entry {
  name: string;
  path: string;
  git?: boolean;
}

export interface WorkspaceChild {
  child?: Child;
  controller: AbortController;
  done: Promise<void>;
  progress: string;
  gone: boolean;
  noClone: boolean;
  state: string;
  error: string;
  active: number;
  lastActive: number;
}

/**
 * The workbench: recent and pinned workspaces, their child processes, folder
 * browsing and pull request clone preparation.
 */
export class Workbench {
  readonly children = new Map<string, WorkspaceChild>();
  private readonly reap: ReturnType<typeof setInterval>;
  readonly store: WorkbenchStore;
  readonly base: string;
  readonly cwd: string;
  readonly command: string[];
  readonly features: string[];
  constructor(options: {
    store: WorkbenchStore;
    base: string;
    cwd: string;
    command: string[];
    features: string[];
  }) {
    this.store = options.store;
    this.base = options.base;
    this.cwd = options.cwd;
    this.command = options.command;
    this.features = options.features;
    this.reap = setInterval(() => {
      for (const [id, workspace] of this.children)
        if (!workspace.active && Date.now() - workspace.lastActive > 1800000) void this.stop(id);
    }, 60000);
  }

  childBase(id: string): string {
    return this.base + 'w/' + id + '/';
  }

  state() {
    return {
      cwd: this.cwd,
      home: homedir(),
      sep: '/',
      version: '',
      items: this.store.items().map((it) => {
        const child = this.children.get(it.id);
        return {
          ...it,
          state: child?.state ?? 'stopped',
          ...(child?.error ? { error: child.error } : {}),
          ...(child?.progress ? { progress: child.progress } : {}),
          href: this.childBase(it.id),
        };
      }),
    };
  }

  expand(path: string, base = this.cwd): string {
    path = path.trim();
    if (path === '~' || /^~[/\\]/.test(path)) path = join(homedir(), path.slice(1));
    return resolve(base, path || base);
  }

  git(dir: string): boolean {
    return existsSync(join(dir, '.git'));
  }

  browse(path: string, hidden: boolean) {
    const dir = this.expand(path);
    const entries = this.entries(dir)
      .filter((entry) => hidden || !entry.name.startsWith('.'))
      .slice(0, 5000)
      .sort(compare);
    const probe = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--show-toplevel']);
    return {
      path: dir,
      parent: dirname(dir) === dir ? '' : dirname(dir),
      git: this.git(dir) || probe.exitCode === 0,
      entries,
    };
  }

  entries(dir: string): Entry[] {
    return readdirSync(dir)
      .filter((name) => {
        try {
          return statSync(join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => ({
        name,
        path: join(dir, name),
        ...(this.git(join(dir, name)) ? { git: true } : {}),
      }));
  }

  complete(query: string) {
    if (!query.trim() || query.includes('://')) return { entries: [] };
    let typed = query,
      prefix = '';
    if (!query.endsWith('/')) {
      const i = query.lastIndexOf('/');
      if (i >= 0) {
        typed = query.slice(0, i + 1);
        prefix = query.slice(i + 1);
      } else if (query === '~') typed = '~/';
      else {
        typed = '';
        prefix = query;
      }
    }
    const dir = this.expand(typed);
    try {
      const entries = this.entries(dir)
        .filter(
          (entry) =>
            entry.name.toLowerCase().startsWith(prefix.toLowerCase()) &&
            (!entry.name.startsWith('.') || prefix.startsWith('.')),
        )
        .map((entry) => ({ ...entry, path: typed + entry.name + '/' }));
      entries.sort(
        (a, b) =>
          Number(b.name.startsWith(prefix)) - Number(a.name.startsWith(prefix)) || compare(a, b),
      );
      return { dir, entries: entries.slice(0, 50) };
    } catch {
      return { entries: [] };
    }
  }

  mkdir(path: string, base: string) {
    const dir = this.expand(path, base || this.cwd);
    if (existsSync(dir)) throw new ServiceError('conflict', dir + ' already exists');
    mkdirSync(dir, { recursive: true });
    return { path: dir };
  }

  open(target: string, id: string, clone: string) {
    let item = this.store.get(id);
    if (id && !item) throw new ServiceError('not-found', 'unknown workspace');
    if (!item) {
      target = target.trim();
      if (!target)
        throw new ServiceError('invalid', 'enter a directory path or a pull request URL');
      const pr = detectPR(target);
      if (pr) {
        if (this.features.includes('-no-git'))
          throw new ServiceError(
            'invalid',
            'git is required for PR review; restart faah without -no-git',
          );
        item = {
          id: itemID('pr', `${pr.provider}/${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase()),
          kind: 'pr',
          url: target,
          repo: pr.owner + '/' + pr.repo,
          number: pr.number,
          lastOpened: 0,
        };
      } else {
        if (/^https?:\/\//.test(target))
          throw new ServiceError(
            'invalid',
            'not a pull or merge request URL (e.g. ' + prURLExamples + ')',
          );
        const root = resolveTarget(this.expand(target)).root;
        item = dirItem(root);
      }
    }
    if (item.kind === 'pr' && item.repo) {
      const managed = managedClone(item.repo);
      if (!clone && !findClone(this.store, item.repo, this.cwd))
        return { needClone: true, repo: item.repo, managed: managed.replace(homedir(), '~') };
      if (clone) {
        const path = clone === 'managed' ? managed : cloneOf(this.expand(clone), item.repo);
        if (!path)
          throw new ServiceError(
            'invalid',
            `${this.expand(clone).replace(homedir(), '~')} is not a clone of ${item.repo}: none of its remotes points there`,
          );
        this.store.rememberClone(item.repo, path);
      }
    }
    const known = Boolean(this.store.get(item.id));
    this.store.record(item);
    this.start(item, !known);
    return { id: item.id, href: this.childBase(item.id) };
  }

  start(item: Item, forget = false): WorkspaceChild {
    const existing = this.children.get(item.id);
    if (existing && ['running', 'starting'].includes(existing.state)) return existing;
    const workspace: WorkspaceChild = {
      controller: new AbortController(),
      done: Promise.resolve(),
      progress: '',
      gone: false,
      noClone: false,
      state: 'starting',
      error: '',
      active: 0,
      lastActive: Date.now(),
    };
    this.children.set(item.id, workspace);
    workspace.done = this.run(workspace, item, forget);
    return workspace;
  }

  private async run(workspace: WorkspaceChild, item: Item, forget: boolean): Promise<void> {
    try {
      const cwd =
        item.kind === 'pr'
          ? await prepareClone({
              store: this.store,
              item,
              cwd: this.cwd,
              signal: workspace.controller.signal,
              progress: (message) => {
                workspace.progress = message;
              },
            })
          : this.cwd;
      if (workspace.controller.signal.aborted) {
        workspace.state = 'stopped';
        return;
      }
      const child = new Child(
        [
          ...this.command,
          ...this.features,
          '-workbench-child',
          '-host',
          '127.0.0.1',
          '-port',
          '0',
          '-no-open',
          '-no-update',
          '-no-color',
          '-base-path',
          this.childBase(item.id),
          item.path ?? item.url ?? '',
        ],
        cwd,
      );
      workspace.child = child;
      workspace.progress = '';
      await child.ready;
      workspace.state = 'running';
      if (item.kind === 'pr') void this.learnTitle(item, child.origin);
      await child.exited;
      workspace.state = 'stopped';
      if (child.process.exitCode !== 0)
        workspace.error =
          child.log
            .filter((line) => line.trim())
            .at(-1)
            ?.trim() || 'faah exited unexpectedly';
    } catch (error) {
      workspace.progress = '';
      workspace.state = workspace.controller.signal.aborted ? 'stopped' : 'failed';
      workspace.error = errorMessage(error);
      workspace.noClone = workspace.error.startsWith('no local clone');
      if (forget && workspace.state === 'failed') {
        workspace.gone = true;
        this.store.remove(item.id);
      }
    }
  }

  private async learnTitle(item: Item, origin: string): Promise<void> {
    try {
      const response = await fetch(origin + this.childBase(item.id) + 'api/meta', {
        signal: AbortSignal.timeout(5000),
      });
      const meta: unknown = await response.json();
      if (
        typeof meta === 'object' &&
        meta !== null &&
        'pr' in meta &&
        typeof meta.pr === 'object' &&
        meta.pr !== null &&
        'title' in meta.pr &&
        typeof meta.pr.title === 'string'
      ) {
        const title = meta.pr.title;
        this.store.db
          .transaction(() => {
            const known = this.store.get(item.id);
            if (known) this.store.put({ ...known, title });
          })
          .immediate();
      }
    } catch {
      return;
    }
  }

  async stop(id: string): Promise<void> {
    const workspace = this.children.get(id);
    if (!workspace) return;
    workspace.controller.abort();
    await workspace.child?.stop();
    await workspace.done;
  }

  async remove(id: string): Promise<void> {
    await this.stop(id);
    this.children.delete(id);
    this.store.remove(id);
  }

  async close(): Promise<void> {
    clearInterval(this.reap);
    await Promise.all([...this.children.keys()].map((id) => this.stop(id)));
  }
}

function compare(a: Entry, b: Entry): number {
  return a.name.toLowerCase() < b.name.toLowerCase()
    ? -1
    : a.name.toLowerCase() > b.name.toLowerCase()
      ? 1
      : 0;
}
