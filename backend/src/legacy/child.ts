import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
export class Child {
  readonly process: ChildProcessWithoutNullStreams;
  readonly ready: Promise<string>;
  readonly exited: Promise<void>;
  origin = '';
  log: string[] = [];
  constructor(command: string[], cwd: string, timeout = 180000) {
    const exe = command[0];
    if (!exe) throw new Error('child executable is required');
    this.process = spawn(exe, command.slice(1), {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdin.on('error', () => {
      /* A failed child may close stdin before shutdown. */
    });
    this.exited = new Promise((resolve) => this.process.once('close', () => resolve()));
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.process.kill('SIGKILL');
        reject(new Error('timed out while starting'));
      }, timeout);
      let buffer = '';
      this.process.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const match = /faah-ready (\S+)/.exec(line);
          if (match?.[1]) {
            clearTimeout(timer);
            this.origin = 'http://' + match[1];
            resolve(this.origin);
          } else {
            this.log.push(line);
            this.log = this.log.slice(-20);
          }
        }
      });
      this.process.stderr.on('data', (chunk: Buffer) => {
        this.log.push(chunk.toString());
        this.log = this.log.slice(-20);
      });
      this.process.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.process.once('close', () => {
        clearTimeout(timer);
        reject(new Error(this.log.join('\n') || 'faah exited before it was ready'));
      });
    });
  }
  async stop(grace = 5000): Promise<void> {
    this.process.stdin.end();
    const timer = setTimeout(() => this.process.kill('SIGKILL'), grace);
    await this.exited;
    clearTimeout(timer);
  }
}
