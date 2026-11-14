import { GitProcesses } from './process.ts';
import { GitProbe, repoKey } from './probe.ts';

export class GitCommands {
  readonly probe: GitProbe;
  constructor(
    readonly processes = new GitProcesses(),
    enabled = true,
  ) {
    this.probe = new GitProbe(processes, enabled);
  }
  async text(root: string, args: readonly string[], gate = false): Promise<string> {
    if (gate && !(await this.probe.get(root))) return '';
    try {
      const result = await this.processes.run(root, args);
      return result.code === 0 ? result.stdout : '';
    } catch {
      return '';
    }
  }
  async records(
    root: string,
    args: readonly string[],
    consume: (record: string) => void,
    delimiter = 0,
  ): Promise<boolean> {
    try {
      return (await this.processes.run(root, args, { consume, delimiter })).code === 0;
    } catch {
      return false;
    }
  }
  async paths(root: string, args: readonly string[]): Promise<string[]> {
    const info = await this.probe.get(root);
    if (!info) return [];
    const key = repoKey(info, root),
      paths: string[] = [];
    const ok = await this.records(root, args, (raw) => {
      if (!raw) return;
      const path = key(raw);
      if (path !== undefined) paths.push(path);
    });
    return ok ? paths : [];
  }
}
export function atoi(value: string): number | undefined {
  if (!/^[+-]?\d+$/.test(value)) return;
  const integer = BigInt(value);
  if (integer < -9223372036854775808n || integer > 9223372036854775807n) return;
  return Number(integer);
}
export function validSHA(value: string): boolean {
  return /^[0-9a-fA-F]{4,40}$/.test(value);
}
export const commitDiffArgs = ['--no-commit-id', '-r', '-m', '--first-parent', '--root'];
