import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createGitStore } from './store.js';
import { cleanCommitMessage, gitCounts, syncPlan, syncNotice } from './logic.js';
const disposers = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(options = {}) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const app = createAppStore();
    app.actions.setWorkspace({ git: true });
    const request = vi.fn(async (path) =>
      path === 'api/unpushed'
        ? { commits: [], upstream: 'origin/main' }
        : { commits: [], files: [{ path: 'one.js' }] },
    );
    const post = options.post || vi.fn(async () => ({}));
    const git = createGitStore(app, { request, post, openFile: vi.fn(), ...options });
    return { app, git, request, post };
  });
}
test('shapes messages, counts and sync decisions', () => {
  expect(cleanCommitMessage('```text\n"Fix the test"\n```')).toBe('Fix the test');
  expect(gitCounts({ statuses: { a: 'M', b: 'U' }, staged: { a: true } })).toEqual({
    staged: 1,
    changed: 2,
    hasChanges: true,
    label: '1 of 2 staged',
  });
  expect(syncPlan({ ahead: 2, behind: 1 })).toEqual({ pull: true, push: true });
  expect(syncNotice({ inProgress: 'rebase' }).choices).toEqual(['finish', 'abort']);
});
test('commit pending state prevents double submission and clears the message', async () => {
  let finish;
  const post = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { git } = fixture({ post });
  git.actions.setCommitMessage('Fix file');
  const operation = git.actions.commit();
  expect(git.state.pending).toBe('Commit');
  await git.actions.commit();
  expect(post).toHaveBeenCalledTimes(1);
  finish({});
  await operation;
  expect(git.state.message).toBe('');
  expect(git.state.pending).toBe('');
});
test('pull divergence becomes an actionable notice and force push needs confirmation', async () => {
  const error = Object.assign(new Error('Diverged'), {
    body: { code: 'diverged', ahead: 2, behind: 1 },
  });
  const { git, app, post } = fixture({ post: vi.fn().mockRejectedValue(error) });
  await git.actions.pullGit();
  expect(git.state.notice.choices).toEqual(['rebase', 'merge']);
  app.actions.acceptGitSnapshot({ git: true, rewritten: true });
  await git.actions.pushGit();
  expect(git.state.notice.choices).toEqual(['force', 'dismiss']);
  expect(post).toHaveBeenCalledTimes(1);
});
test('commit files deduplicate, retry failures, and unpushed follows snapshots', async () => {
  const { git, request, app } = fixture();
  const a = git.actions.loadCommitFiles('abc');
  const b = git.actions.loadCommitFiles('abc');
  expect(a).toBe(b);
  await a;
  expect(request).toHaveBeenCalledTimes(1);
  app.actions.acceptGitSnapshot({ git: true, ahead: 1, recentCommits: [{ hash: 'abc' }] });
  await vi.waitFor(() => expect(git.state.upstream).toBe('origin/main'));
  app.actions.acceptGitSnapshot({ git: true, ahead: 1, recentCommits: [{ hash: 'abc' }] });
  expect(request).toHaveBeenCalledTimes(2);
});
