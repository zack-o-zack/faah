import type { GitProcesses } from './process.ts';

// Refresh only stat metadata, never staged content. A copied repository can
// otherwise make every read-only status scan hash all its unchanged files.
export async function primeGitCache(root: string, processes: GitProcesses): Promise<void> {
  try {
    // Modified/unmerged files return 1 while still refreshing clean entries.
    await processes.run(root, ['update-index', '--refresh']);
  } catch {
    // Cache priming is optional, including outside Git and in read-only repos.
  }
}
