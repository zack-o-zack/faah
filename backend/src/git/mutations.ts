import { relative, join, sep } from 'node:path';
import { trimSpace } from '../text.ts';
import { GitCommands } from './commands.ts';
import { GitSync } from './sync.ts';

export class NotFastForward extends Error {
  constructor() {
    super('not a fast-forward');
  }
}
export class GitMutations {
  constructor(
    readonly commands: GitCommands,
    readonly sync = new GitSync(commands),
  ) {}
  private async checked(
    root: string,
    args: string[],
    label: string,
    input?: string,
  ): Promise<void> {
    const result = await this.commands.processes.run(root, args, { input });
    if (result.code !== 0)
      throw new Error(label + ': exit status ' + result.code + ': ' + trimSpace(result.output));
  }
  stage(root: string, path: string): Promise<void> {
    return this.checked(root, ['add', '-A', '--', path || '.'], 'git add');
  }
  async unstage(root: string, path: string): Promise<void> {
    path ||= '.';
    const result = await this.commands.processes.run(root, ['reset', 'HEAD', '--', path]);
    if (result.code === 0) return;
    if ((await this.commands.processes.run(root, ['rm', '-r', '--cached', '--', path])).code === 0)
      return;
    throw new Error('git reset: exit status ' + result.code + ': ' + trimSpace(result.output));
  }
  staged(root: string): Promise<string[]> {
    return this.commands.paths(root, ['diff', '--name-only', '--cached', '-z']);
  }
  async commit(root: string, message: string): Promise<void> {
    if (!(await this.staged(root)).length) throw new Error('nothing staged to commit');
    await this.checked(root, ['commit', '-m', message], 'git commit');
  }
  async hunk(root: string, path: string, hunk: string, action: string): Promise<void> {
    const info = await this.commands.probe.get(root);
    if (!info) throw new Error('git repository not available');
    hunk = hunk.replace(/[\r\n]+$/, '');
    if (!hunk.startsWith('@@')) throw new Error('hunk must start with @@ header');
    const repoPath = relative(info.top, join(root, path)).split(sep).join('/');
    const patch =
      'diff --git a/' +
      repoPath +
      ' b/' +
      repoPath +
      '\n--- a/' +
      repoPath +
      '\n+++ b/' +
      repoPath +
      '\n' +
      hunk +
      '\n';
    const apply = (flags: string[]) =>
      this.commands.processes.run(
        info.top,
        ['apply', '--unidiff-zero', '--whitespace=nowarn', ...flags, '-'],
        { input: patch },
      );
    let flags: string[], label: string;
    if (action === 'stage') {
      flags = ['--cached'];
      label = 'git apply --cached';
    } else if (action === 'unstage') {
      flags = ['--cached', '-R'];
      label = 'git apply --cached -R';
    } else if (action === 'discard') {
      if ((await apply(['--index', '-R'])).code === 0) return;
      flags = ['-R'];
      label = 'git apply -R';
    } else throw new Error('unknown hunk action ' + JSON.stringify(action));
    const result = await apply(flags);
    if (result.code !== 0)
      throw new Error(label + ': exit status ' + result.code + ': ' + trimSpace(result.output));
  }
  async pull(root: string, remote: string, ref: string): Promise<void> {
    await this.checked(root, ['fetch', '--no-tags', remote, ref], 'git fetch');
    if ((await this.commands.processes.run(root, ['merge', '--ff-only', 'FETCH_HEAD'])).code !== 0)
      throw new NotFastForward();
  }
  push(root: string, remote?: string, branch?: string) {
    return this.commands.processes.run(
      root,
      remote === undefined ? ['push'] : ['push', '-u', remote, branch ?? ''],
    );
  }
  async abort(root: string): Promise<void> {
    const op = await this.sync.operation(root);
    if (!op) throw new Error('no rebase or merge in progress');
    await this.checked(root, [op, '--abort'], 'git ' + op + ' --abort');
  }
}
