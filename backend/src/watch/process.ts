import { resolve } from 'node:path';
import { reply } from './protocol.ts';
import type { Callback } from './binding.ts';
import { readRecords } from '../git/records.ts';
import { message } from '../decode.ts';

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
function command(): string[] {
  return [
    process.execPath,
    ...(Bun.embeddedFiles.length
      ? ['--internal-watcher']
      : [resolve(import.meta.dir, 'helper.ts')]),
  ];
}
export class WatcherProcess {
  private child: Bun.Subprocess<'pipe', 'pipe', 'ignore'> | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly callbacks = new Map<number, Callback>();
  private readonly retiring = new Set<Promise<unknown>>();
  private next = 0;
  private closed = false;
  constructor(
    readonly argv: string[] = command(),
    readonly timeout = 5000,
  ) {}
  get pid(): number | undefined {
    return this.child?.pid;
  }
  private start() {
    if (this.closed) throw new Error('watcher closed');
    if (this.child) return this.child;
    const child = Bun.spawn(this.argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' });
    this.child = child;
    void readRecords(child.stdout, 10, (line) => {
      if (!line || this.child !== child) return;
      const value = reply(line),
        callback = this.callbacks.get(value.id);
      if (value.error !== undefined) {
        const error = new Error(value.error);
        if (this.pending.has(value.id)) this.stop(error, true);
        else callback?.(error, []);
      } else if (value.events) callback?.(null, value.events);
      else {
        const call = this.pending.get(value.id);
        if (call) {
          clearTimeout(call.timer);
          this.pending.delete(value.id);
          call.resolve();
        }
      }
    }).catch((error: unknown) => {
      if (this.child === child) this.stop(new Error(message(error)), true);
    });
    void child.exited.then((code) => {
      if (this.child === child) this.stop(new Error('watcher helper exited: ' + code), true);
    });
    return child;
  }
  private stop(error: Error, notify: boolean): void {
    const child = this.child;
    this.child = undefined;
    const active = [...this.callbacks]
      .filter(([id]) => !this.pending.has(id))
      .map(([, callback]) => callback);
    this.callbacks.clear();
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    if (child) {
      // A blocked native startup cannot process stdin EOF or a JS signal handler.
      child.kill('SIGKILL');
      const task = child.exited;
      this.retiring.add(task);
      void task.finally(() => this.retiring.delete(task));
    }
    if (notify) for (const callback of active) callback(error, []);
  }
  private call(id: number, root: string, type: 'subscribe' | 'unsubscribe'): Promise<void> {
    const child = this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.stop(new Error('watcher ' + type + ' timed out'), true),
        this.timeout,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ id, root, type }) + '\n');
      } catch (error) {
        this.stop(new Error(message(error)), true);
      }
    });
  }
  async subscribe(root: string, callback: Callback): Promise<() => Promise<void>> {
    const id = ++this.next;
    this.callbacks.set(id, callback);
    try {
      await this.call(id, root, 'subscribe');
    } catch (error) {
      this.callbacks.delete(id);
      throw error;
    }
    const child = this.child;
    return async () => {
      if (this.child !== child || !this.callbacks.delete(id)) return;
      await this.call(id, root, 'unsubscribe');
      if (!this.callbacks.size && !this.pending.size) this.stop(new Error('watcher idle'), false);
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.stop(new Error('watcher closed'), false);
    await Promise.allSettled(this.retiring);
  }
}
