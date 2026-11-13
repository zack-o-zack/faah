import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, now, sleep } from './util.ts';

export const flags = [
  '-host',
  '127.0.0.1',
  '-port',
  '0',
  '-no-open',
  '-no-update',
  '-no-color',
  '-no-lsp',
  '-no-agent',
  '-no-telemetry',
];
export async function rss(pid: number): Promise<number> {
  const rows = (await command(['ps', '-axo', 'pid=,ppid=,rss=']))
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, parent] of rows) {
      if (
        id !== undefined &&
        parent !== undefined &&
        descendants.has(parent) &&
        !descendants.has(id)
      ) {
        descendants.add(id);
        changed = true;
      }
    }
  }
  return rows.reduce(
    (total, [id, , kb]) => total + (id !== undefined && descendants.has(id) ? (kb ?? 0) * 1024 : 0),
    0,
  );
}
export async function launch(bin: string, dir?: string) {
  const temp = await mkdtemp(join(tmpdir(), 'faah-bench-state-'));
  const env = {
    ...process.env,
    HOME: temp,
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    DO_NOT_TRACK: '1',
    FAAH_TELEMETRY: '0',
    FAAH_DEV_ROOT: '',
  };
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  const args = dir
    ? ['-workbench-child', '-base-path', '/', ...flags, dir]
    : ['-desktop-host', ...flags];
  const started = now();
  const child = Bun.spawn([bin, ...args], {
    env,
    cwd: temp,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  async function stop() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    await child.exited;
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
  const deadline = setTimeout(() => child.kill('SIGKILL'), 180000);
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Backend exited before ready: ${await errors}`);
      buffer += new TextDecoder().decode(chunk.value);
      const match = /(?:^|\n)faah-(?:desktop-)?ready ([^\r\n]+)/.exec(buffer);
      if (match?.[1]) {
        const address = match[1];
        const baseUrl = address.startsWith('http') ? address : `http://${address}/`;
        clearTimeout(deadline);
        // Keep draining stdout so a chatty backend cannot block on its pipe.
        void (async () => {
          while (!(await reader.read()).done) {}
        })().catch(() => {});
        return { baseUrl, pid: child.pid, started, readyLineMs: now() - started, stop };
      }
      await sleep(0);
    }
  } catch (error) {
    clearTimeout(deadline);
    await stop();
    throw error;
  }
}
