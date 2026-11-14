import { realpathSync, statSync } from 'node:fs';
import { resolve, dirname, relative, basename, isAbsolute } from 'node:path';
export interface Target {
  root: string;
  file: string;
  line: number;
}
export function resolveTarget(target: string): Target {
  let path = target;
  let line = 0;
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(target);
  if (match?.[1] && match[2]) {
    try {
      statSync(match[1]);
      path = match[1];
      line = Number(match[2]);
    } catch {
      /* A numeric suffix belongs to the filename unless its candidate exists. */
    }
  }
  const root = realpathSync(resolve(path));
  const info = statSync(root);
  if (info.isDirectory()) return { root, file: '', line: 0 };
  if (!info.isFile()) throw new Error('not a regular file or directory: ' + root);
  const git = Bun.spawnSync(['git', '-C', dirname(root), 'rev-parse', '--show-toplevel']);
  if (git.exitCode === 0) {
    const top = git.stdout.toString().trim();
    return { root: top, file: relative(top, root), line };
  }
  const cwd = realpathSync(process.cwd());
  const rel = relative(cwd, root);
  if (!isAbsolute(path) && !rel.startsWith('..')) return { root: cwd, file: rel, line };
  return { root: dirname(root), file: basename(root), line };
}
export interface PR {
  provider: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}
export const prURLExamples =
  'https://github.com/owner/repo/pull/123, https://gitlab.com/group/project/-/merge_requests/45, https://codeberg.org/owner/repo/pulls/7, or https://bitbucket.org/workspace/repo/pull-requests/9';
export function detectPR(text: string): PR | undefined {
  text = text.trim();
  const github = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(text);
  const bitbucket =
    /^(?:https?:\/\/)?(?:www\.)?bitbucket\.org\/([^/\s]+)\/([^/\s]+?)\/pull-requests\/(\d+)/.exec(
      text,
    );
  if (github || bitbucket) {
    const m = github ?? bitbucket;
    if (!m?.[1] || !m[2] || !m[3]) return;
    return {
      provider: github ? 'github' : 'bitbucket',
      owner: m[1],
      repo: m[2].replace(/\.git$/, ''),
      number: Number(m[3]),
      url: text,
    };
  }
  const gitlab = /^(?:https?:\/\/)?([^/\s]+)\/(.+)\/([^/\s]+?)\/-\/merge_requests\/(\d+)/.exec(
    text,
  );
  const gitea = /^(?:https?:\/\/)?([^/\s]+)\/([^/\s]+)\/([^/\s]+?)\/pulls\/(\d+)/.exec(text);
  const m = gitlab ?? gitea;
  if (!m?.[1] || !m[2] || !m[3] || !m[4] || (!gitlab && m[1].toLowerCase() === 'github.com'))
    return;
  return {
    provider: gitlab ? 'gitlab' : 'gitea',
    owner: m[2],
    repo: m[3].replace(/\.git$/, ''),
    number: Number(m[4]),
    url: text,
  };
}
