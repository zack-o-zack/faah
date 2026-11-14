import { GitCommands, commitDiffArgs, validSHA } from './commands.ts';
export const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export class GitDiff {
  constructor(readonly commands: GitCommands) {}
  async against(root: string, path: string, base = 'HEAD'): Promise<string> {
    if (!(await this.commands.probe.get(root))) return '';
    try {
      const result = await this.commands.processes.run(root, [
        'diff',
        '--no-color',
        base,
        '--',
        path,
      ]);
      if (result.code === 0) return result.stdout;
      if (base === 'HEAD')
        return this.commands.text(root, ['diff', '--no-color', emptyTree, '--', path]);
    } catch {
      /* Git reads fail quiet, including outside a repository. */
    }
    return '';
  }
  between(root: string, path: string, from: string, to: string): Promise<string> {
    return this.commands.text(root, ['diff', '--no-color', from, to, '--', path], true);
  }
  commit(root: string, path: string, sha: string): Promise<string> {
    return validSHA(sha)
      ? this.commands.text(
          root,
          ['diff-tree', '-p', '--no-color', ...commitDiffArgs, sha, '--', path],
          true,
        )
      : Promise.resolve('');
  }
  mergeBase(root: string, from: string, to: string): Promise<string> {
    return this.commands.text(root, ['merge-base', from, to], true).then((text) => text.trim());
  }
}
