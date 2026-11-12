import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const serverFlags = ['-host', '127.0.0.1', '-port', '0', '-no-open', '-no-lsp', '-no-agent', '-no-update', '-no-telemetry'];
export async function startServer(binary, workspace) {
  const state = await mkdtemp(path.join(tmpdir(), 'faah-bench-web-'));
  await mkdir(path.join(state, 'config'), { recursive: true });
  const child = spawn(binary, [...serverFlags, workspace], {
    env: { ...process.env, XDG_CONFIG_HOME: path.join(state, 'config'), XDG_STATE_HOME: path.join(state, 'state'),
      GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '', failure;
  child.on('error', error => { failure = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log = (log + chunk).slice(-32_000); });
  async function stop() {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await new Promise(resolve => child.once('exit', resolve));
      }
    }
    await rm(state, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Binary exited ${child.exitCode}`);
      const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {
        try {
          const response = await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(1000) });
          const meta = await response.json();
          if (response.ok && meta.ready) return { url, meta, stop };
        } catch { /* Indexing/server startup can briefly refuse connections. */ }
      }
      await delay(100);
    }
    throw new Error('Readiness timed out after 60s (waiting for URL and /api/meta ready)');
  } catch (error) {
    await stop();
    throw new Error(`Server for ${workspace}: ${error.message}\n${log}`, { cause: error });
  }
}
