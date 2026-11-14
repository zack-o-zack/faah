import { emptyGit, type GitState } from '../index/types.ts';
import { GitProbe, repoKey } from './probe.ts';
import { StatusParser, NameStatusParser } from './status-parser.ts';
import { dictionary } from './maps.ts';

export class GitStatus {
  constructor(readonly probe: GitProbe) {}
  async read(root: string, base = 'HEAD', head = ''): Promise<GitState> {
    const info = await this.probe.get(root);
    if (!info) return emptyGit();
    const key = repoKey(info, root),
      parser = new StatusParser(key);
    try {
      const result = await this.probe.processes.run(
        root,
        ['status', '--porcelain=v2', '-z', '-uall'],
        {
          consume: (field) => parser.record(field),
        },
      );
      if (result.code !== 0) return { ...emptyGit(), git: true };
      const state = parser.state;
      if (head) state.yourStatuses = await this.overlay(root, key, state.statuses, head);
      if (base && base !== 'HEAD')
        state.statuses = await this.overlay(root, key, state.statuses, base);
      return state;
    } catch {
      return { ...emptyGit(), git: true };
    }
  }
  private async overlay(
    root: string,
    key: (path: string) => string | undefined,
    worktree: Record<string, string>,
    ref: string,
  ): Promise<Record<string, string>> {
    const statuses = dictionary<string>();
    for (const [path, status] of Object.entries(worktree)) statuses[path] = status;
    if (!ref || ref === 'HEAD') return statuses;
    const extra = dictionary<string>();
    const parser = new NameStatusParser(({ path, status }) => {
      const mapped = key(path);
      if (mapped !== undefined) extra[mapped] = status;
    });
    const result = await this.probe.processes.run(root, ['diff', '--name-status', '-z', ref], {
      consume: (field) => parser.record(field),
    });
    if (result.code === 0)
      for (const [path, status] of Object.entries(extra))
        if (!Object.hasOwn(statuses, path)) statuses[path] = status;
    return statuses;
  }
}
