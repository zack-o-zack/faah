import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import { fixture } from '../../test/contract/fixtures.ts';
import { launch } from '../../bench/launch.ts';
import { ready } from '../../bench/http.ts';
import { cloneWorkspace, command } from '../../bench/util.ts';
import { record, string } from '../src/decode.ts';
import { markdownHighlights, highlightedText } from '../../test/contract/highlight.ts';
const go = process.env.FAAH_LEGACY_BIN,
  bun = process.env.FAAH_BIN;
if (!go || !bun) throw new Error('Set FAAH_LEGACY_BIN and FAAH_BIN');
const binaries = [go, bun];
interface FileTokens {
  lang: string;
  lines: string[];
  markdown?: string;
}
interface Agreement {
  kind: string;
  lang: string;
  files: number;
  bytes: number;
  matched: number;
  styledBytes: number;
  styledMatched: number;
}
function tokens(html: string): { text: string; classes: string[] } {
  const classes: string[] = [];
  let cls = '',
    offset = 0,
    text = '';
  function append(value: string): void {
    const decoded = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    text += decoded;
    for (const c of decoded)
      for (let i = 0; i < Buffer.byteLength(c); i++)
        classes.push(/\s/u.test(c) ? 'whitespace' : cls);
  }
  for (const match of html.matchAll(/<i class=([a-z]+)>|<\/i>/g)) {
    append(html.slice(offset, match.index));
    cls = match[1] ?? '';
    offset = match.index + match[0].length;
  }
  append(html.slice(offset));
  return { text, classes };
}
const report: Agreement[] = [];
const markdownDifferences: { path: string; expected: string; actual: string }[] = [];
async function compare(root: string, paths: string[], kind: string): Promise<void> {
  const captures: Map<string, FileTokens>[] = [];
  for (const binary of binaries) {
    const server = await launch(binary, root),
      results = new Map<string, FileTokens>();
    try {
      await ready(server.baseUrl, server.started);
      for (const path of paths) {
        const url = new URL('api/file', server.baseUrl);
        url.search = new URLSearchParams({ path, count: '10000' }).toString();
        let value = record(await (await fetch(url)).json());
        for (let i = 0; value.refine === true && i < 100; i++) {
          await Bun.sleep(20);
          value = record(await (await fetch(url)).json());
        }
        if (!Array.isArray(value.lines)) throw new Error(path + ': ' + JSON.stringify(value));
        const captured: FileTokens = {
          lang: string(value.lang),
          lines: value.lines.map((v) => string(v)),
        };
        if (/\.md$/i.test(path)) {
          const markdownURL = new URL('api/markdown', server.baseUrl);
          markdownURL.searchParams.set('path', path);
          captured.markdown = string(record(await (await fetch(markdownURL)).json()).html);
        }
        results.set(path, captured);
      }
    } finally {
      await server.stop();
    }
    captures.push(results);
  }
  for (const path of paths) {
    const reference = captures[0]?.get(path),
      candidate = captures[1]?.get(path);
    if (!reference || !candidate || reference.lang !== candidate.lang)
      throw new Error('language mismatch ' + path);
    if (
      reference.markdown !== undefined &&
      candidate.markdown !== undefined &&
      markdownHighlights(reference.markdown) !== markdownHighlights(candidate.markdown)
    )
      markdownDifferences.push({ path, expected: reference.markdown, actual: candidate.markdown });
    let row = report.find((r) => r.kind === kind && r.lang === reference.lang);
    if (!row) {
      row = {
        kind,
        lang: reference.lang,
        files: 0,
        bytes: 0,
        matched: 0,
        styledBytes: 0,
        styledMatched: 0,
      };
      report.push(row);
    }
    row.files++;
    if (reference.lines.length !== candidate.lines.length)
      throw new Error('line count mismatch ' + path);
    for (let i = 0; i < reference.lines.length; i++) {
      const a = reference.lines[i] ?? '',
        b = candidate.lines[i] ?? '';
      if (highlightedText(a) !== highlightedText(b))
        throw new Error('escaped text mismatch ' + path + ':' + (i + 1));
      const x = tokens(a),
        y = tokens(b);
      for (let j = 0; j < x.classes.length; j++) {
        const left = x.classes[j],
          right = y.classes[j];
        if (left === 'whitespace') continue;
        row.bytes++;
        if (left === right) row.matched++;
        if (left || right) {
          row.styledBytes++;
          if (left === right) row.styledMatched++;
        }
      }
    }
  }
}
const contract = await fixture();
try {
  const paths = [
    'src/hello.go',
    'src/hello.ts',
    'src/hello.py',
    'src/large.go',
    'src/large.ts',
    'src/large.py',
    'README.md',
    'crlf.txt',
    'tabs.txt',
    'empty.txt',
    'unicode/你好-😀-é.txt',
  ];
  await compare(contract.root, paths, 'contract');
} finally {
  await contract.cleanup();
}
for (const repo of ['flask', 'redis', 'react', 'kubernetes']) {
  const workspace = await cloneWorkspace(join(homedir(), '.cache/faah-bench/repos', repo));
  try {
    const groups = new Map<string, string[]>();
    for (const path of (await command(['git', 'ls-files'], workspace.dir)).split('\n').sort()) {
      const ext = extname(path);
      if (
        ![
          '.go',
          '.py',
          '.c',
          '.h',
          '.rs',
          '.ts',
          '.tsx',
          '.js',
          '.jsx',
          '.json',
          '.yaml',
          '.yml',
          '.sh',
          '.css',
          '.md',
          '.html',
          '.toml',
        ].includes(ext)
      )
        continue;
      const size = (await stat(join(workspace.dir, path)).catch(() => undefined))?.size ?? 0;
      if (size < 200 || size > 65536) continue;
      const group = groups.get(ext) ?? [];
      group.push(path);
      groups.set(ext, group);
    }
    const paths: string[] = [];
    let index = 0;
    while (paths.length < 50) {
      let added = 0;
      for (const group of groups.values()) {
        const path = group[index];
        if (path) {
          paths.push(path);
          added++;
          if (paths.length === 50) break;
        }
      }
      if (!added) break;
      index++;
    }
    process.stdout.write(repo + ': ' + paths.length + ' files\n');
    await compare(workspace.dir, paths, 'corpus');
  } finally {
    await workspace.cleanup();
  }
}
const results = report.map((r) => ({
  ...r,
  agreement: r.bytes ? (100 * r.matched) / r.bytes : 100,
  styledAgreement: r.styledBytes ? (100 * r.styledMatched) / r.styledBytes : 100,
}));
await Bun.write(
  process.env.FAAH_TOKEN_REPORT ?? '/tmp/faah-phase3-token-agreement.json',
  JSON.stringify(results, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(results) + '\n');

await Bun.write(
  '/tmp/faah-phase3-markdown-diffs.json',
  JSON.stringify(markdownDifferences, null, 2) + '\n',
);
if (markdownDifferences.length)
  throw new Error('Markdown structure mismatches: ' + markdownDifferences.length);
