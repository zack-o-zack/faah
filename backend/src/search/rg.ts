import rgAsset from '../../node_modules/@vscode/ripgrep/bin/rg' with { type: 'file' };
import { mkdir, chmod, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { record, number } from '../decode.ts';
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
export function decodeMatch(value: unknown): RGMatch | undefined {
  const v = record(value);
  if (v.type !== 'match') return;
  const d = record(v.data);
  if (!Array.isArray(d.submatches)) throw new Error('invalid submatches');
  return {
    path: Buffer.from(bytes(d.path)).toString(),
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
}): Promise<{ code: number; stderr: string }> {
  const child = Bun.spawn([await rgPath(), ...options.args], {
    cwd: options.root,
    stdin: options.input === undefined ? 'ignore' : Buffer.from(options.input),
    stdout: 'pipe',
    stderr: 'pipe',
    signal: options.signal,
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let start = 0;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n', start)) {
        const text = buffer.slice(start, end);
        start = end + 1;
        if (!text) continue;
        const value: unknown = JSON.parse(text);
        const hit = decodeMatch(value);
        if (hit) await options.match(hit);
        else if (options.complete) {
          const event = record(value);
          if (event.type === 'end')
            options.complete(Buffer.from(bytes(record(event.data).path)).toString());
        }
      }
      buffer = buffer.slice(start);
    }
  } catch (error) {
    child.kill();
    await child.exited;
    await errors;
    if (!options.signal.aborted) throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return { code: await child.exited, stderr: await errors };
}
