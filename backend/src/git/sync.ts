import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { trimSpace } from '../text.ts';
import { GitCommands, atoi, validSHA } from './commands.ts';

export interface AheadBehind {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}
function counts(text: string): AheadBehind | undefined {
  const parts = trimSpace(text).split(/\s+/);
  if (parts.length < 2) return;
  return { ahead: atoi(parts[0] ?? '') ?? 0, behind: atoi(parts[1] ?? '') ?? 0, hasUpstream: true };
}
export class GitSync {
  constructor(readonly commands: GitCommands) {}
  async branch(root: string): Promise<string> {
    const branch = trimSpace(await this.commands.text(root, ['rev-parse', '--abbrev-ref', 'HEAD']));
    return (
      branch ||
      trimSpace(await this.commands.text(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']))
    );
  }
  async head(root: string): Promise<string> {
    return trimSpace(await this.commands.text(root, ['rev-parse', '--short', 'HEAD']));
  }
  async upstream(
    root: string,
    branch: string,
  ): Promise<{ remote: string; branch: string } | undefined> {
    const text = trimSpace(
      await this.commands.text(root, ['rev-parse', '--abbrev-ref', branch + '@{u}']),
    );
    const slash = text.indexOf('/');
    return slash < 0 ? undefined : { remote: text.slice(0, slash), branch: text.slice(slash + 1) };
  }
  async remote(root: string, branch = ''): Promise<string> {
    if (branch) {
      const upstream = await this.upstream(root, branch);
      if (upstream) {
        const url = trimSpace(
          await this.commands.text(root, ['config', '--get', 'remote.' + upstream.remote + '.url']),
        );
        if (url) return url;
      }
    }
    return trimSpace(await this.commands.text(root, ['config', '--get', 'remote.origin.url']));
  }
  async aheadBehind(root: string): Promise<AheadBehind> {
    const empty = { ahead: 0, behind: 0, hasUpstream: false };
    if (!(await this.commands.probe.get(root))) return empty;
    const upstream = counts(
      await this.commands.text(root, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    );
    if (upstream) return upstream;
    const branch = await this.branch(root);
    if (!branch || branch === 'HEAD') return empty;
    const origin = counts(
      await this.commands.text(root, [
        'rev-list',
        '--left-right',
        '--count',
        'HEAD...origin/' + branch,
      ]),
    );
    if (origin) return origin;
    if (!(await this.remote(root))) return empty;
    const ahead =
      atoi(trimSpace(await this.commands.text(root, ['rev-list', '--count', 'HEAD']))) ?? 0;
    return ahead > 0 ? { ahead, behind: 0, hasUpstream: false } : empty;
  }
  async countSince(root: string, base: string): Promise<number> {
    return validSHA(base)
      ? (atoi(
          trimSpace(await this.commands.text(root, ['rev-list', '--count', base + '..HEAD'])),
        ) ?? 0)
      : 0;
  }
  async aheadBehindRef(root: string, ref: string): Promise<AheadBehind> {
    return (
      counts(
        await this.commands.text(root, ['rev-list', '--left-right', '--count', 'HEAD...' + ref]),
      ) ?? { ahead: 0, behind: 0, hasUpstream: false }
    );
  }
  async operation(root: string): Promise<string> {
    const info = await this.commands.probe.get(root);
    if (!info) return '';
    const exists = async (name: string) =>
      Boolean(await stat(join(info.dir, name)).catch(() => undefined));
    if ((await exists('rebase-merge')) || (await exists('rebase-apply'))) return 'rebase';
    return (await exists('MERGE_HEAD')) ? 'merge' : '';
  }
  async rebasingBranch(root: string): Promise<string> {
    const info = await this.commands.probe.get(root);
    if (!info) return '';
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      const text = await readFile(join(info.dir, dir, 'head-name'), 'utf8').catch(() => undefined);
      if (text !== undefined) return trimSpace(text).replace(/^refs\/heads\//, '');
    }
    return '';
  }
  async dirty(root: string): Promise<boolean> {
    return Boolean(
      trimSpace(await this.commands.text(root, ['status', '--porcelain', '-uall'], true)),
    );
  }
}
