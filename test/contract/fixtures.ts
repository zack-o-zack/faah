import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Fixture {
  temp: string;
  root: string;
  env: NodeJS.ProcessEnv;
  first: string;
  head: string;
  remote: string;
  git(...args: string[]): string;
  write(path: string, content: string | Uint8Array): Promise<void>;
  cleanup(): Promise<void>;
}

export async function fixture(): Promise<Fixture> {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'faah-contract-')));
  const root = join(temp, 'workspace');
  for (const dir of ['workspace', 'home', 'config', 'state', 'cache']) await mkdir(join(temp, dir));
  // Use an allowlist: no inherited credentials, Git config, dev assets or service flags.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: temp,
    HOME: join(temp, 'home'),
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_STATE_HOME: join(temp, 'state'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Contract Author',
    GIT_AUTHOR_EMAIL: 'contract@example.invalid',
    GIT_COMMITTER_NAME: 'Contract Author',
    GIT_COMMITTER_EMAIL: 'contract@example.invalid',
    GIT_AUTHOR_DATE: '2020-01-02T03:04:05+00:00',
    GIT_COMMITTER_DATE: '2020-01-02T03:04:05+00:00',
    LC_ALL: 'C',
    TZ: 'UTC',
    DO_NOT_TRACK: '1',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const write = async (path: string, content: string | Uint8Array) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.quotePath', 'false');
  git('config', 'commit.gpgsign', 'false');
  const files: Record<string, string> = {
    '.gitignore': 'ignored/\n*.log\n/root-only.txt\ncache/\n!keep.log\n',
    '.hidden': 'dotfile\n',
    'nested/.gitignore': '*.tmp\n!keep.tmp\n/anchored.txt\nonly-dir/\n',
    'nested/deep/leaf.txt': 'nested leaf needle\n',
    'nested/keep.tmp': 'kept\n',
    'nested/drop.tmp': 'ignored nested\n',
    'nested/anchored.txt': 'anchored\n',
    'nested/deep/anchored.txt': 'not anchored\n',
    'nested/only-dir/file.txt': 'dir only\n',
    'nested/deep/only-dir': 'file allowed\n',
    'ignored/secret.txt': 'ignored needle\n',
    'root-only.txt': 'root ignored\n',
    'keep.log': 'negated\n',
    'drop.log': 'ignored log\n',
    'cache/data.txt': 'cache needle\n',
    'unicode/你好-😀-é.txt': '你好 😀 é İ K ſ É é ASCII ascii\n前缀 needle 后缀\n',
    'crlf.txt': 'one\r\ntwo\r\n\tthree\r\n',
    'tabs.txt': '\talpha\tbeta\n',
    'long.txt': 'x'.repeat(21050) + '\t尾\n',
    'empty.txt': '',
    'README.md':
      '# Hello\n\n# Hello\n\n## 你好 😀\n\n| A | B |\n| - | - |\n| x | y |\n\n- [x] done\n- [ ] todo\n\nFootnote[^a].\n\n[^a]: note\n\n```go\nfunc Hello() {}\n```\n\n```ts\nconst x = 1;\n```\n\n```python\ndef hello():\n    return "你好"\n```\n\n<div class="raw">raw <b>HTML</b></div>\n',
    'data.csv': '\ufeffname,note\n"Doe, Jane","line one\nline two"\nragged\na,b,c\n',
    'data.tsv': '\ufeffname\tcity\n"Doe, Jane"\t東京\nshort\n',
    'bad.csv': 'a,b\n"unterminated,value\n',
    'empty.csv': '',
    'staged.txt': 'stage before\n',
    'unstaged.txt': 'before\n',
    'partial.txt': 'first\nsecond\nthird\n',
    'deleted.txt': 'delete me\n',
    'rename-old.txt': 'rename content\n',
    'history.txt': 'first revision\n',
    'src/hello.go': 'package demo\n\nfunc Hello() string {\n\treturn "needle"\n}\n',
    'src/hello.ts': 'export function Hello(): string {\n\treturn "needle";\n}\n',
    'src/hello.py': 'def Hello():\n\treturn "needle"\n',
    'caps.txt': Array.from({ length: 80 }, (_, i) => `capneedle ${i}`).join('\n') + '\n',
  };
  for (const [path, content] of Object.entries(files)) await write(path, content);
  for (const [ext, line] of [
    ['go', '// chunk line'],
    ['ts', '// chunk line'],
    ['py', '# chunk line'],
  ]) {
    const prefix =
      ext === 'go'
        ? 'package demo\n\nvar banner = `'
        : ext === 'ts'
          ? 'export const banner = `'
          : 'banner = \"\"\"';
    const suffix = ext === 'py' ? '\"\"\"\n\ndef Large():\n    return banner\n' : '`;\n';
    await write(
      `src/large.${ext}`,
      prefix +
        '\n' +
        Array.from({ length: 1205 }, (_, i) => `${line} ${i}`).join('\n') +
        '\n' +
        suffix,
    );
  }
  await write('binary.bin', new Uint8Array([0, 1, 2, 255, 10]));
  await write(
    'pixel.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLPsAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await symlink('history.txt', join(root, 'link.txt'));
  await writeFile(join(temp, 'home', 'outside.txt'), 'controlled external symlink target\n');
  await symlink('../home/outside.txt', join(root, 'external-link.txt'));
  git('add', '.');
  git('commit', '-qm', 'Initial fixture');
  const first = git('rev-parse', 'HEAD');
  await write('history.txt', 'second revision\n');
  git('add', 'history.txt');
  git('commit', '-qm', 'Update history');
  const head = git('rev-parse', 'HEAD');
  const remote = join(temp, 'remote.git');
  git('init', '-q', '--bare', '-b', 'main', remote);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  await write('staged.txt', 'stage after\n');
  git('add', 'staged.txt');
  await write('partial.txt', 'FIRST\nsecond\nthird\n');
  git('add', 'partial.txt');
  await write('partial.txt', 'FIRST\nsecond\nTHIRD\n');
  await write('unstaged.txt', 'after\n');
  await write('untracked.txt', 'untracked needle\n');
  await rm(join(root, 'deleted.txt'));
  git('mv', 'rename-old.txt', 'rename-new.txt');
  // Oversized preview input is ignored by searches, but readable explicitly.
  await write('ignored/huge.md', 'z'.repeat(4 * 1024 * 1024 + 1));
  return {
    temp,
    root,
    env,
    first,
    head,
    remote,
    git,
    write,
    cleanup: () => rm(temp, { recursive: true, force: true }),
  };
}
