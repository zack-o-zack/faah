import { goString } from '../render/text.ts';
import { readRecords } from './records.ts';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
}
export interface GitRun {
  globalArgs?: readonly string[];
  input?: string;
  signal?: AbortSignal;
  delimiter?: number;
  consume?: (record: string) => void;
}
interface Waiter {
  ready: () => void;
  signal: AbortSignal;
  abort: () => void;
}

export class GitProcesses {
  private used = 0;
  private readonly queue: Waiter[] = [];
  private readonly controller = new AbortController();
  private readonly tasks = new Set<Promise<GitResult>>();
  constructor(
    readonly limit = 4,
    private readonly command: readonly string[] = ['git'],
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('invalid Git process limit');
  }
  get active(): number {
    return this.used;
  }
  private async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.used < this.limit) {
      this.used++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        ready: resolve,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal.reason);
        },
      };
      this.queue.push(waiter);
      signal.addEventListener('abort', waiter.abort, { once: true });
    });
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.signal.removeEventListener('abort', next.abort);
      next.ready();
    } else this.used--;
  }
  run(root: string, args: readonly string[], options: GitRun = {}): Promise<GitResult> {
    const signal = options.signal
      ? AbortSignal.any([this.controller.signal, options.signal])
      : this.controller.signal;
    const task = this.execute(root, args, options, signal);
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
    return task;
  }
  private async execute(
    root: string,
    args: readonly string[],
    options: GitRun,
    signal: AbortSignal,
  ): Promise<GitResult> {
    await this.acquire(signal);
    try {
      signal.throwIfAborted();
      return await this.spawn(root, args, options, signal);
    } finally {
      this.release();
    }
  }
  private async spawn(
    root: string,
    args: readonly string[],
    options: GitRun,
    signal: AbortSignal,
  ): Promise<GitResult> {
    const child = Bun.spawn([...this.command, ...(options.globalArgs ?? []), '-C', root, ...args], {
      env: { ...this.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdin: options.input === undefined ? 'ignore' : 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const stdout: Uint8Array[] = [],
      stderr: Uint8Array[] = [],
      combined: Uint8Array[] = [];
    const read = async (stream: ReadableStream<Uint8Array>, target: Uint8Array[]) => {
      for await (const chunk of stream) {
        target.push(chunk);
        combined.push(chunk);
      }
    };
    const tasks: Promise<unknown>[] = [
      options.consume
        ? readRecords(child.stdout, options.delimiter ?? 0, options.consume)
        : read(child.stdout, stdout),
      read(child.stderr, stderr),
      child.exited,
    ];
    try {
      if (options.input !== undefined) child.stdin?.write(options.input);
      tasks.push(Promise.resolve(child.stdin?.end()).then(() => undefined));
      await Promise.all(tasks);
      signal.throwIfAborted();
      const out = goString(Buffer.concat(stdout)),
        error = goString(Buffer.concat(stderr));
      return {
        code: child.exitCode ?? 1,
        stdout: out,
        stderr: error,
        output: !stderr.length ? out : !stdout.length ? error : goString(Buffer.concat(combined)),
      };
    } catch (error) {
      child.kill();
      await Promise.allSettled(tasks);
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  async close(): Promise<void> {
    this.controller.abort(new Error('Git process pool closed'));
    await Promise.allSettled(this.tasks);
  }
}
