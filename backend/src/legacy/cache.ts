// Refresh only stat metadata, never staged content. A copied repository can
// otherwise make every read-only status scan hash all its unchanged files.
export async function primeGitCache(root: string): Promise<void> {
  try {
    const child = Bun.spawn(['git', 'update-index', '--refresh'], {
      cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    // Modified/unmerged files return 1 while still refreshing clean entries.
    await child.exited;
  } catch {
    // Cache priming is optional, including outside Git and in read-only repos.
  }
}
