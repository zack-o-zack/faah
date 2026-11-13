import type { PREditorOptions } from './test-editor.ts';
import { decodeAgentJob } from '../agents/job-decode.ts';
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createPREditor, routes } from './test-editor.ts';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));
afterEach(() => vi.useRealTimers());

function fixture(options: PREditorOptions = {}) {
  return createRoot((dispose) => {
    const editor = createPREditor(options);
    editor.actions.refreshPRMeta = vi.fn(async () => {});
    return { editor, dispose };
  });
}
const status = (state: string, fields = {}) => ({
  canMerge: true,
  base: 'main',
  commits: [{ sha: 'a' }, { sha: 'b' }],
  status: { state, methods: ['merge', 'squash'] },
  defaults: {
    squash: { title: 'Fix the parser (#7)', message: '* a\n* b' },
    merge: { title: 'Merge', message: '' },
  },
  ...fields,
});

test('an unknown mergeability is re-read until the forge decides', async () => {
  vi.useFakeTimers();
  const replies = [status('unknown'), status('clean')];
  const request = vi.fn(async () => replies.shift());
  const { editor, dispose } = fixture({ request });
  await editor.actions.refreshMergeStatus();
  expect(editor.merge.pill()?.text).toBe('Checking…');
  await vi.advanceTimersByTimeAsync(2500);
  expect(editor.merge.pill()?.text).toBe('Ready to merge');
  expect(request).toHaveBeenCalledTimes(2);
  dispose();
});

test('the dialog opens on the chosen method with the forge defaults', async () => {
  const { editor, dispose } = fixture({
    request: routes({ 'api/pr/merge-status': status('clean') }),
  });
  await editor.actions.openMergeDialog('merge');
  expect(editor.merge.state.dialog).toMatchObject({ open: true, method: 'merge' });
  editor.actions.setMergeMethod('squash');
  expect(editor.merge.method()).toBe('squash');
  editor.actions.setMergeField('title', '');
  await editor.actions.confirmMerge();
  expect(editor.merge.state.dialog.error).toBe('The commit needs a title.');
  editor.actions.resetMergeMessage();
  expect(editor.merge.state.dialog.drafts.squash?.title).toBe('Fix the parser (#7)');
  dispose();
});

test('confirming merges with the edited message, then re-reads the PR', async () => {
  const post = vi.fn(async () => ({}));
  const { editor, dispose } = fixture({
    request: routes({ 'api/pr/merge-status': status('clean') }),
    post,
  });
  await editor.actions.openMergeDialog('squash');
  editor.actions.setMergeField('message', 'short');
  await editor.actions.confirmMerge();
  expect(post).toHaveBeenCalledWith('api/pr/merge', {
    method: 'squash',
    title: 'Fix the parser (#7)',
    message: 'short',
  });
  expect(editor.merge.state.dialog.open).toBe(false);
  expect(editor.actions.refreshPRMeta).toHaveBeenCalled();
  dispose();
});

test('a blocking warning or a failed merge keeps the dialog open', async () => {
  const post = vi.fn(async () => {
    throw new Error('Base branch was modified');
  });
  const replies = [status('clean'), status('conflicts')];
  const { editor, dispose } = fixture({ request: vi.fn(async () => replies.shift()), post });
  await editor.actions.openMergeDialog('squash');
  await editor.actions.confirmMerge();
  expect(editor.merge.state.dialog).toMatchObject({
    open: true,
    pending: false,
    error: 'Base branch was modified',
  });
  await vi.waitFor(() => expect(editor.merge.warnings()?.block).toMatch(/conflicts/));
  post.mockClear();
  await editor.actions.confirmMerge();
  expect(post).not.toHaveBeenCalled();
  dispose();
});

test('the harness rewrite fills the message and shows its progress', async () => {
  const { editor, dispose } = fixture({
    request: routes({ 'api/pr/merge-status': status('clean') }),
  });
  await editor.actions.openMergeDialog('squash');
  editor.actions.runAgentJob.mockImplementation(async (endpoint, _params, { progress } = {}) => {
    expect(endpoint).toBe('api/pr/merge-message');
    progress?.(decodeAgentJob({ ms: 2000 }));
    expect(editor.merge.state.dialog.rewriting).toEqual({ pending: true, seconds: 2 });
    return decodeAgentJob({ stdout: 'Better title\n\nBetter body' });
  });
  await editor.actions.setMergeRewrite(true);
  await vi.waitFor(() => expect(editor.merge.state.dialog.rewriting.pending).toBe(false));
  expect(editor.merge.state.dialog.drafts.squash).toEqual({
    title: 'Better title',
    message: 'Better body',
  });
  dispose();
});

test('the merge fix runs the pill action', async () => {
  const { editor, dispose } = fixture({
    request: routes({ 'api/pr/merge-status': status('behind') }),
  });
  await editor.actions.refreshMergeStatus();
  editor.actions.runMergeFix();
  expect(editor.actions.resolvePRBase).toHaveBeenCalled();
  dispose();
});
