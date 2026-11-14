import rgAsset from '../../node_modules/@vscode/ripgrep/bin/rg' with { type: 'file' };
import { mkdir, chmod, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { record, number } from '../decode.ts';
import type { RGProfile } from './profile.ts';
import { FileDispatch } from './dispatch.ts';
let extracting: Promise<string> | undefined;
export function rgPath(): Promise<string> {
  extracting ??= (async () => {
    const dir = join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), '.faah/cache'),
      'faah',
      'ripgrep-1.17.0',
      process.platform + '-' + process.arch,
    );
    const path = join(dir, 'rg');
    try {
      if ((await stat(path)).size === (await Bun.file(rgAsset).size)) return path;
    } catch {
      /* Install the pinned embedded executable into a versioned cache. */
    }
    await mkdir(dir, { recursive: true });
    const temp = path + '.' + crypto.randomUUID();
    await Bun.write(temp, Bun.file(rgAsset));
    await chmod(temp, 0o755);
    await rename(temp, path);
    return path;
  })();
  return extracting;
}
export interface RGMatch {
  path: string;
  line: Uint8Array;
  lineNumber: number;
  matches: { start: number; end: number }[];
}
function bytes(value: unknown): Uint8Array {
  const v = record(value);
  if (typeof v.text === 'string') return Buffer.from(v.text);
  if (typeof v.bytes === 'string') return Buffer.from(v.bytes, 'base64');
  throw new Error('invalid rg text');
}
function pathText(value: unknown): string {
  const v = record(value);
  return typeof v.text === 'string' ? v.text : Buffer.from(bytes(v)).toString();
}
export function decodeMatch(value: unknown): RGMatch | undefined {
  const v = record(value);
  if (v.type !== 'match') return;
  const d = record(v.data);
  if (!Array.isArray(d.submatches)) throw new Error('invalid submatches');
  return {
    path: pathText(d.path),
    line: bytes(d.lines),
    lineNumber: number(d.line_number),
    matches: d.submatches.map((v) => {
      const m = record(v);
      return { start: number(m.start), end: number(m.end) };
    }),
  };
}
export async function runRG(options: {
  root: string;
  args: string[];
  signal: AbortSignal;
  match: (match: RGMatch) => Promise<void>;
  complete?: (path: string) => void;
  input?: string;
  profile?: (profile: RGProfile) => void;
  concurrency?: number;
}): Promise<{ code: number; stderr: string }> {
  const start = performance.now();
  const executable = await rgPath();
  const resolved = performance.now();
  const child = Bun.spawn([executable, ...options.args], {
    cwd: options.root,
    stdin: options.input === undefined ? 'ignore' : Buffer.from(options.input),
    stdout: 'pipe',
    stderr: 'pipe',
    signal: options.signal,
  });
  const spawned = performance.now();
  const timing: RGProfile = {
    resolveMs: resolved - start,
    spawnMs: spawned - resolved,
    firstByteMs: null,
    runMs: 0,
    parseMs: 0,
    acceptMs: 0,
    events: 0,
    bytes: 0,
  };
  const accept = async (hit: RGMatch) => {
    const start = options.profile ? performance.now() : 0;
    await options.match(hit);
    if (options.profile) timing.acceptMs += performance.now() - start;
  };
  const dispatch =
    options.concurrency && options.concurrency > 1
      ? new FileDispatch({
          concurrency: options.concurrency,
          match: accept,
          complete: options.complete,
        })
      : undefined;
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (timing.firstByteMs === null) timing.firstByteMs = performance.now() - spawned;
      timing.bytes += chunk.value.byteLength;
      buffer += decoder.decode(chunk.value, { stream: true });
      let start = 0;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n', start)) {
        const text = buffer.slice(start, end);
        start = end + 1;
        if (!text) continue;
        const parsing = options.profile ? performance.now() : 0;
        const value: unknown = JSON.parse(text);
        const hit = decodeMatch(value);
        if (options.profile) {
          timing.events++;
          timing.parseMs += performance.now() - parsing;
        }
        if (hit) {
          if (dispatch) dispatch.match(hit);
          else await accept(hit);
        } else if (options.complete || options.profile || dispatch) {
          const event = record(value);
          if (event.type === 'end') {
            const path = pathText(record(event.data).path);
            if (dispatch) await dispatch.complete(path);
            else options.complete?.(path);
          }
          if (event.type === 'summary' && options.profile) {
            const stats = record(record(event.data).stats);
            timing.searchedFiles = number(stats.searches);
            timing.searchedBytes = number(stats.bytes_searched);
          }
        }
      }
      buffer = buffer.slice(start);
    }
    await dispatch?.finish();
  } catch (error) {
    child.kill();
    await child.exited;
    await errors;
    await dispatch?.finish().catch(() => undefined);
    if (!options.signal.aborted) throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const result = { code: await child.exited, stderr: await errors };
  timing.runMs = performance.now() - spawned;
  if (options.profile) {
    const usage = child.resourceUsage();
    if (usage) {
      timing.cpuUserMs = Number(usage.cpuTime.user) / 1000;
      timing.cpuSystemMs = Number(usage.cpuTime.system) / 1000;
    }
  }
  options.profile?.(timing);
  return result;
}
