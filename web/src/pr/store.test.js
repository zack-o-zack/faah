import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createPREditor, prMeta, routes } from './test-editor.js';

vi.mock('../lib/toast.jsx', () => ({ toast: vi.fn() }));

function fixture(options) {
  let editor, dispose;
  createRoot((release) => {
    dispose = release;
    editor = createPREditor(options);
  });
  return { editor, dispose };
}
const comments = {
  'api/pr/comments': {
    comments: [{ id: 'd1', path: 'a.go', line: 3, side: 'RIGHT', body: 'nit' }],
  },
  'api/pr/existing-comments': {
    issueComments: [{ id: 1, author: 'ann', body: 'Hi' }],
    reviewComments: [{ id: 5, path: 'a.go', line: 3, author: 'bob', body: 'Why?' }],
  },
  'api/pr/merge-status': { canMerge: true, status: { state: 'clean', methods: ['squash'] } },
};

test('initializing loads drafts, posted comments and merge status', async () => {
  const { editor, dispose } = fixture({ request: routes(comments) });
  editor.actions.initializePR();
  await vi.waitFor(() => expect(editor.merge.state.info).not.toBe(null));
  expect(editor.pr.commentCount()).toBe(3);
  expect(editor.pr.marker('a.go', 'RIGHT', 3)).toBe(2);
  expect(editor.merge.canMerge()).toBe(true);
  dispose();
});

test('a review submit is pending, then clears drafts; a failure keeps them with the error', async () => {
  let fail = true;
  const post = routes({
    'api/pr/submit': () => {
      if (fail) throw new Error('No permission');
      return {};
    },
  });
  const { editor, dispose } = fixture({ request: routes(comments), post });
  await editor.actions.refreshPRComments();
  editor.actions.setReviewPanel(true);
  const sent = editor.actions.submitReview('APPROVE');
  expect(editor.pr.state.review.pending).toBe('APPROVE');
  await sent;
  expect(editor.pr.state.review).toMatchObject({ pending: '', error: 'No permission', open: true });
  expect(editor.pr.state.drafts).toHaveLength(1);
  fail = false;
  await editor.actions.submitReview('APPROVE');
  expect(editor.pr.state.review).toMatchObject({ open: false, error: '' });
  expect(editor.pr.state.drafts).toHaveLength(0);
  dispose();
});

test('requesting changes needs a body or drafts', async () => {
  const post = vi.fn();
  const { editor, dispose } = fixture({ post });
  await editor.actions.submitReview('REQUEST_CHANGES');
  expect(editor.pr.state.review.error).toMatch(/Add a comment/);
  expect(post).not.toHaveBeenCalled();
  dispose();
});

test('writes in a read-only session open the Connect dialog instead', async () => {
  const post = vi.fn();
  const { editor, dispose } = fixture({
    meta: prMeta({ readOnly: true }),
    forge: { info: { label: 'GitHub' }, hasToken: false },
    post,
  });
  await editor.actions.submitReview('COMMENT');
  editor.actions.setIssueBody('hello');
  await editor.actions.sendIssueComment();
  expect(post).not.toHaveBeenCalled();
  expect(editor.forge.state).toMatchObject({ open: true, reason: 'to post comments' });
  dispose();
});

test('a composer adds a draft and closes; a failure stays open with the error', async () => {
  let fail = true;
  const post = routes({
    'api/pr/comments': (body) => {
      if (fail) throw new Error('Line is outside the diff');
      return { id: 'd9', ...body };
    },
  });
  const { editor, dispose } = fixture({ post });
  editor.actions.openPRComposer({ path: 'a.go', l1: 4, l2: 4 });
  expect(editor.actions.setSelection).toHaveBeenCalledWith(null);
  const [composer] = editor.pr.state.composers;
  expect(editor.pr.composersAt('a.go', 'RIGHT', 4)).toHaveLength(1);
  editor.actions.setComposerBody(composer.id, 'rename this');
  await editor.actions.sendComposer(composer.id);
  expect(editor.pr.state.composers[0]).toMatchObject({
    pending: false,
    error: 'Line is outside the diff',
  });
  fail = false;
  await editor.actions.sendComposer(composer.id);
  expect(editor.pr.state.composers).toHaveLength(0);
  expect(editor.pr.state.drafts[0]).toMatchObject({ id: 'd9', line: 4, body: 'rename this' });
  expect(editor.pr.state.expanded['a.go|RIGHT:4']).toBe(true);
  dispose();
});

test('applying drafts reports progress and keeps the harness error', async () => {
  const { editor, dispose } = fixture({ request: routes(comments) });
  await editor.actions.refreshPRComments();
  let finish;
  editor.actions.runAgentJob.mockImplementation((endpoint, params, { progress }) => {
    expect(params.edits).toEqual([{ path: 'a.go', l1: 3, l2: 3, instruction: 'nit' }]);
    progress({ ms: 4200 });
    return new Promise((resolve) => (finish = resolve));
  });
  const applying = editor.actions.applyDrafts();
  expect(editor.pr.state.batch).toMatchObject({ pending: true, seconds: 4 });
  finish({ error: 'Harness quit', changed: [] });
  await applying;
  expect(editor.pr.state.batch).toMatchObject({ pending: false, error: 'Harness quit' });
  expect(editor.actions.reloadWorkspace).not.toHaveBeenCalled();
  dispose();
});

test('replying to an author prefixes the mention once and opens the panel', () => {
  const { editor, dispose } = fixture();
  editor.actions.replyToAuthor('ann');
  editor.actions.replyToAuthor('ann');
  expect(editor.pr.state.issue.body).toBe('@ann ');
  expect(editor.pr.state.panel.collapsed).toBe(false);
  editor.actions.setPRPanelHeight(10);
  expect(editor.pr.state.panel.height).toBe(80);
  dispose();
});
