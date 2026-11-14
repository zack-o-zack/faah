import { readdirSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { stateDir } from '../store/db.ts';
import type { WorkbenchStore, Item } from './store.ts';
import { cloneAuth } from './auth.ts';
import { detectPR } from '../cli/target.ts';
export function managedClone(repo: string): string {
  return join(stateDir(), 'repos', repo);
}
function git(dir: string, args: string[]): string {
  const p = Bun.spawnSync(['git', '-C', dir, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return p.exitCode === 0 ? p.stdout.toString().trim() : '';
}
export function cloneOf(dir: string, repo: string): string {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return '';
  for (const remote of git(top, ['remote', '-v']).split('\n')) {
    const url = remote.split(/\s+/)[1] ?? '';
    const path = url
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
      .toLowerCase();
    if (path.endsWith('/' + repo.toLowerCase()) || path.endsWith(':' + repo.toLowerCase()))
      return top;
  }
  return '';
}
export function findClone(store: WorkbenchStore, repo: string, cwd: string): string {
  const dirs = [
    store.clone(repo),
    ...store
      .items()
      .filter((i) => i.kind === 'dir')
      .map((i) => i.path ?? ''),
    cwd,
  ];
  for (const dir of dirs) {
    const top = cloneOf(dir, repo);
    if (top) {
      store.rememberClone(repo, top);
      return top;
    }
  }
  const roots = [
    'workspace',
    'workspaces',
    'code',
    'src',
    'projects',
    'dev',
    'repos',
    'git',
    'github',
    'work',
    'Developer',
    'Documents/GitHub',
    'go/src/github.com',
    '',
  ].map((p) => join(homedir(), p));
  roots.push(...dirs.filter(Boolean).map(dirname), cwd);
  const queue = roots.map((path) => ({ path, depth: 0 }));
  const seen = new Set<string>();
  let budget = 20000;
  const deadline = Date.now() + 1500;
  const skip = new Set([
    'node_modules',
    'vendor',
    'target',
    'build',
    'dist',
    'Library',
    'Applications',
    'AppData',
    'venv',
    '__pycache__',
  ]);
  while (queue.length && budget > 0 && Date.now() < deadline) {
    const node = queue.shift();
    if (!node || seen.has(node.path)) continue;
    seen.add(node.path);
    try {
      for (const ent of readdirSync(node.path, { withFileTypes: true })) {
        budget--;
        if (!ent.isDirectory() || ent.name.startsWith('.') || skip.has(ent.name)) continue;
        const path = join(node.path, ent.name);
        if (
          ent.name.toLowerCase() === basename(repo).toLowerCase() &&
          existsSync(join(path, '.git'))
        ) {
          const top = cloneOf(path, repo);
          if (top) {
            store.rememberClone(repo, top);
            return top;
          }
        }
        if (node.depth + 1 < 3) queue.push({ path, depth: node.depth + 1 });
      }
    } catch {
      continue;
    }
  }
  return '';
}
const pending = new Map<string, Promise<string>>();
export async function prepareClone(options: {
  store: WorkbenchStore;
  item: Item;
  cwd: string;
  signal: AbortSignal;
  progress: (value: string) => void;
}): Promise<string> {
  const { store, item, cwd, signal, progress } = options;
  const repo = item.repo ?? '';
  const dest = managedClone(repo);
  if (store.clone(repo) !== dest) {
    progress('Looking for a local clone of ' + repo);
    const top = findClone(store, repo, cwd);
    if (top) return top;
    throw new Error(
      'no local clone of ' +
        repo +
        ' found; open the pull request again from the workbench to choose one',
    );
  }
  const old = pending.get(repo);
  if (old) return old;
  const work = (async () => {
    const top = cloneOf(dest, repo);
    if (top) return top;
    const pr = detectPR(item.url ?? '');
    if (!pr) throw new Error('not a pull request URL: ' + item.url);
    const auth = cloneAuth(pr);
    const url = new URL(pr.url.includes('://') ? pr.url : 'https://' + pr.url);
    const cloneURL = 'https://' + url.host + '/' + repo + '.git';
    progress(
      `Cloning ${repo} into ${dest.replace(homedir(), '~')} (once; later pull requests reuse it)`,
    );
    mkdirSync(dirname(dest), { recursive: true });
    const temp = mkdtempSync(join(dirname(dest), '.' + basename(dest) + '-'));
    const child = Bun.spawn(
      ['git', 'clone', '--filter=blob:none', '--no-checkout', cloneURL, temp],
      { env: auth.env, stdout: 'ignore', stderr: 'pipe', signal },
    );
    const output = new Response(child.stderr).text();
    try {
      if ((await child.exited) !== 0)
        throw new Error('git clone ' + repo + ': ' + auth.redact(await output));
      if (existsSync(dest)) rmSync(dest, { recursive: true });
      renameSync(temp, dest);
      store.rememberClone(repo, dest);
      return dest;
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  })();
  pending.set(repo, work);
  try {
    return await work;
  } finally {
    pending.delete(repo);
  }
}
