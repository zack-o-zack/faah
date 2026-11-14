import { remoteHostPath } from './remote.ts';
import { GitCommands } from './commands.ts';
import { GitSync } from './sync.ts';

function escape(value: string, segment: boolean): string {
  let result = '';
  for (const byte of Buffer.from(value)) {
    const c = String.fromCharCode(byte);
    if ((segment ? /^[\w.~$&+:=@-]$/ : /^[\w.~-]$/).test(c)) result += c;
    else if (!segment && byte === 32) result += '+';
    else result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return result;
}
export class GitLinks {
  private readonly sync: GitSync;
  constructor(readonly commands: GitCommands) {
    this.sync = new GitSync(commands);
  }
  private async remote(root: string) {
    return remoteHostPath(await this.sync.remote(root, await this.sync.branch(root)));
  }
  async commits(root: string, branch: string): Promise<string> {
    const remote = remoteHostPath(await this.sync.remote(root, branch));
    if (!remote?.path) return '';
    const segment = remote.host.includes('gitlab') ? '-/commits' : 'commits';
    return (
      'https://' +
      remote.host +
      '/' +
      remote.path +
      '/' +
      segment +
      (branch && branch !== 'HEAD' ? '/' + branch : '')
    );
  }
  async commit(root: string, sha: string): Promise<string> {
    const remote = await this.remote(root);
    if (!remote?.path) return '';
    return (
      'https://' +
      remote.host +
      '/' +
      remote.path +
      (remote.host.includes('gitlab') ? '/-/commit/' : '/commit/') +
      sha
    );
  }
  async author(root: string, email: string, name: string): Promise<string> {
    const remote = await this.remote(root);
    if (!remote?.path || !remote.host.includes('github')) return '';
    let login = email.split('@')[0] ?? '';
    if (email.includes('@') && email.endsWith('users.noreply.github.com')) {
      const plus = login.indexOf('+');
      if (plus >= 0) login = login.slice(plus + 1);
      if (login) return 'https://' + remote.host + '/' + escape(login, true);
    }
    const query = email || name;
    return query
      ? 'https://' + remote.host + '/' + remote.path + '/commits?author=' + escape(query, false)
      : '';
  }
}
