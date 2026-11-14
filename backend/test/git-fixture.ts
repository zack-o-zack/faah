import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { dirname, join } from 'node:path';
import { GitProcesses } from '../src/git/process.ts';
import { GitCommands } from '../src/git/commands.ts';
import { GitStatus } from '../src/git/status.ts';
import { GitMutations } from '../src/git/mutations.ts';
import { GitHistory } from '../src/git/history.ts';
import { GitDiff } from '../src/git/diff.ts';
import { GitSync } from '../src/git/sync.ts';

export async function gitFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'faah-git-native-')));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: root,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@example.com',
    GIT_AUTHOR_DATE: '2020-01-02T03:04:05Z',
    GIT_COMMITTER_DATE: '2020-01-02T03:04:05Z',
  };
  const processes = new GitProcesses(4, ['git'], env),
    commands = new GitCommands(processes);
  const run = async (...args: string[]) => {
    const result = await processes.run(root, args);
    if (result.code) throw new Error(result.output);
    return result.stdout.trim();
  };
  try {
    await run('init', '-q', '-b', 'main');
    await run('config', 'commit.gpgsign', 'false');
  } catch (error) {
    await processes.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    env,
    processes,
    commands,
    run,
    status: new GitStatus(commands.probe),
    mutations: new GitMutations(commands),
    history: new GitHistory(commands),
    diff: new GitDiff(commands),
    sync: new GitSync(commands),
    write: async (path: string, text: string | Uint8Array) => {
      const abs = join(root, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, text);
    },
    cleanup: async () => {
      await processes.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
