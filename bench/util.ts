import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error('Expected JSON object');
  return value;
}
export function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected string');
  return value;
}
export function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected number');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}
export function now(): number {
  return Bun.nanoseconds() / 1e6;
}
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function command(argv: string[], cwd?: string): Promise<string> {
  const child = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.join(' ')}: ${stderr}`);
  return stdout.trim();
}
export function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  function percentile(p: number): number {
    return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  }
  return {
    n: values.length,
    min: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
  };
}
export async function cloneWorkspace(source: string) {
  const temp = await mkdtemp(join(tmpdir(), 'faah-bench-work-'));
  const dir = join(temp, 'repo');
  try {
    await command(['cp', '-c', '-R', source, dir]);
  } catch {
    await rm(dir, { recursive: true, force: true });
    await command(['cp', '-R', source, dir]);
  }
  return { dir, cleanup: () => rm(temp, { recursive: true, force: true }) };
}
