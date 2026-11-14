import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Fixture } from './fixtures.ts';
import { request, object } from './transport.ts';

export interface Server {
  baseUrl: string;
  stop(): Promise<void>;
}
export async function launch(f: Fixture, basePath = '/', workbench = false): Promise<Server> {
  const bin = process.env.FAAH_BIN;
  if (!bin) throw new Error('Set FAAH_BIN to an absolute backend executable path');
  const args = [
    workbench ? '-desktop-host' : '-workbench-child',
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
  if (!workbench) args.push('-base-path', basePath, f.root);
  const child = spawn(bin, args, {
    cwd: f.root,
    env: {
      ...f.env,
      ...(process.env.FAAH_LEGACY_BIN ? { FAAH_LEGACY_BIN: process.env.FAAH_LEGACY_BIN } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdin.on('error', () => {}); // Early startup failure can close the input pipe.
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let ready = false;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
      // Go routes workspace stdin EOF through its interrupt path (exit 130).
      // A replacement may return 0; neither may need the kill fallback.
      const expectedExit = child.exitCode === 0 || (!workbench && child.exitCode === 130);
      if (ready && !expectedExit)
        throw new Error(
          `Backend did not exit cleanly on stdin EOF (${child.exitCode}, ${child.signalCode}): ${output}`,
        );
    })();
    return stopping;
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Backend exited: ${output}`);
      const match = stdout.match(
        workbench ? /faah-desktop-ready (http:\/\/[^\s]+)/ : /faah-ready ([^\s]+)/,
      );
      const address = match?.[1];
      if (address) {
        const baseUrl = workbench ? address : `http://${address}${basePath}`;
        if (!workbench) await waitReady(baseUrl);
        ready = true;
        return { baseUrl, stop };
      }
      await delay(10);
    }
    throw new Error(`Backend readiness timed out: ${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
export const launchWorkbench = (f: Fixture) => launch(f, '/', true);
export async function waitReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const response = await request(baseUrl, 'api/meta');
    if (response.status === 200 && object(response.body) && response.body.ready === true) {
      await request(baseUrl, 'api/git/refresh');
      return;
    }
    await delay(10);
  }
  throw new Error(`Index readiness timed out: ${baseUrl}`);
}
