import { NativeWatcher } from './native.ts';
import type { Callback } from './binding.ts';
import { relative, join, dirname, resolve } from 'node:path';
import { stat, realpath, readFile } from 'node:fs/promises';
import { IgnoreSet, readGitignore } from '../ignore/service.ts';
export interface WatchEvent {
  path: string;
  type?: 'create' | 'update' | 'delete';
}
export function ignoreEvent(path: string): boolean {
  return path === '.gitignore' || path.endsWith('/.gitignore');
}
export function gitEvent(path: string): boolean {
  return (
    path === '.git' ||
    path === '.git/HEAD' ||
    path === '.git/index' ||
    path === '.git/packed-refs' ||
    path === '.git/FETCH_HEAD' ||
    path === '.git/MERGE_HEAD' ||
    path === '.git/rebase-merge' ||
    path === '.git/rebase-apply' ||
    path.startsWith('.git/rebase-merge/') ||
    path.startsWith('.git/rebase-apply/') ||
    path === '.git/refs' ||
    path.startsWith('.git/refs/')
  );
}
export class WorkspaceWatch {
  private readonly native = new NativeWatcher();
  get pid(): number | undefined {
    return this.native.pid;
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  private events = new Map<string, WatchEvent>();
  private work = Promise.resolve();
  private stopped = false;
  private root: string | undefined;
  private unsubscribe: (() => Promise<void>) | undefined;
  private ignores = new Map<string, IgnoreSet>();
  constructor(
    readonly options: {
      root: string;
      availability?: (available: boolean) => void;
      gitDirectory?: () => Promise<string | undefined>;
      changed: (paths: string[], git: boolean) => Promise<void>;
      ignored?: () => Promise<void>;
      delay?: number;
      warn?: (message: string) => void;
      connect?: (root: string, callback: Callback) => Promise<() => Promise<void>>;
    },
  ) {}
  private warn(error: unknown): void {
    this.options.availability?.(false);
    (this.options.warn ?? ((s) => process.stderr.write(s + '\n')))(
      'faah watcher disabled: ' + String(error),
    );
  }
  private callback = (error: Error | null, events: WatchEvent[]): void => {
    if (error) {
      this.warn(error);
      void this.close();
      return;
    }
    this.receive(events);
  };
  async start(): Promise<void> {
    if (this.stopped) return;
    const stops: (() => Promise<void>)[] = [];
    const connect = this.options.connect ?? this.native.subscribe;
    try {
      this.root = await realpath(this.options.root);
      stops.push(await connect(this.root, this.callback));
      const pointer = await readFile(join(this.root, '.git'), 'utf8').catch(() => undefined);
      const discovered = pointer?.startsWith('gitdir:')
        ? resolve(this.root, pointer.slice(7).trim())
        : await this.options.gitDirectory?.();
      if (discovered) {
        const gitdir = await realpath(discovered);
        const common = await readFile(join(gitdir, 'commondir'), 'utf8').catch(() => undefined);
        const dirs = new Set([gitdir]);
        if (common) dirs.add(await realpath(resolve(gitdir, common.trim())));
        for (const dir of dirs) {
          if (dir === this.root || dir.startsWith(this.root + '/')) continue;
          stops.push(
            await connect(dir, (error, events) => {
              if (error) {
                this.callback(error, []);
                return;
              }
              const root = this.root;
              if (root)
                this.receive(
                  events.map((event) => ({
                    ...event,
                    path: join(root, '.git', relative(dir, event.path)),
                  })),
                );
            }),
          );
        }
      }
      const stop = async () => {
        await Promise.all(stops.map((s) => s()));
      };
      if (this.stopped) await stop();
      else {
        this.unsubscribe = stop;
        this.options.availability?.(true);
      }
    } catch (error) {
      await Promise.allSettled(stops.map((s) => s()));
      if (!this.stopped) this.warn(error);
    }
  }
  receive(events: WatchEvent[]): void {
    if (this.stopped) return;
    for (const event of events) {
      const rel = relative(this.root ?? this.options.root, event.path);
      if (!rel || rel.startsWith('../') || rel === '..') continue;
      if ((rel === '.git' || rel.startsWith('.git/')) && !gitEvent(rel)) continue;
      this.events.set(rel, event);
    }
    if (!this.events.size) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const batch = this.events;
      this.events = new Map();
      this.work = this.work
        .catch(() => undefined)
        .then(() => this.flush(batch))
        .catch((error) => this.warn(error));
    }, this.options.delay ?? 50);
  }
  private async ignore(dir: string): Promise<IgnoreSet> {
    const cached = this.ignores.get(dir);
    if (cached) return cached;
    const parent = dir
      ? await this.ignore(dirname(dir) === '.' ? '' : dirname(dir))
      : new IgnoreSet();
    const rules = parent.child(await readGitignore(join(this.options.root, dir), dir));
    this.ignores.set(dir, rules);
    return rules;
  }
  private async included(rel: string, event: WatchEvent): Promise<boolean> {
    let prefix = '';
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      const dir =
        i < parts.length - 1 ||
        (event.type !== 'delete' &&
          (await stat(event.path).catch(() => undefined))?.isDirectory() === true);
      const ignore = await this.ignore(prefix);
      if (ignore.match(path, dir)) return false;
      prefix = path;
    }
    return true;
  }
  private async flush(events: Map<string, WatchEvent>): Promise<void> {
    if (this.stopped) return;
    if ([...events.keys()].some(ignoreEvent)) this.ignores.clear();
    let git = false;
    const paths: string[] = [];
    for (const [rel, event] of events) {
      if (gitEvent(rel)) {
        git = true;
        continue;
      }
      if (ignoreEvent(rel) || (await this.included(rel, event))) paths.push(rel);
    }
    if (paths.length || git) await this.options.changed(paths, git);
    else await this.options.ignored?.();
  }
  async settled(): Promise<void> {
    await this.work;
  }
  async close(): Promise<void> {
    this.stopped = true;
    await this.native.close();
    if (this.timer) clearTimeout(this.timer);
    this.events.clear();
    if (this.unsubscribe) {
      const stop = this.unsubscribe;
      this.unsubscribe = undefined;
      await stop().catch(() => undefined);
    }
    await this.work;
  }
}
