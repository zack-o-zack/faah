import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { toast } from '../lib/toast.jsx';
import { createPREditor } from './test-editor.js';

vi.mock('../lib/toast.jsx', () => ({ toast: vi.fn() }));

function fixture(options) {
  let editor, dispose;
  createRoot((release) => {
    dispose = release;
    editor = createPREditor(options);
  });
  editor.actions.refreshPRMeta = vi.fn(async () => {});
  return { editor, dispose };
}
const forge = { info: { label: 'GitHub' }, hasToken: false, source: '' };

test('without a forge the token lives in Settings', () => {
  const { editor, dispose } = fixture();
  editor.actions.openForgeConnect();
  expect(editor.actions.openSettings).toHaveBeenCalledWith('ui', 'GitHub', 'github.token');
  expect(editor.forge.state.open).toBe(false);
  dispose();
});

test('connecting checks the token, records its source and re-reads the PR', async () => {
  let fail = true;
  const post = vi.fn(async () => {
    if (fail) throw new Error('Bad credentials');
    return { saved: true, validated: true, writeAccess: true };
  });
  const { editor, dispose } = fixture({ forge, post });
  editor.actions.openForgeConnect('to submit a review');
  await editor.actions.submitForgeConnect();
  expect(editor.forge.state.error).toBe('Paste the token first.');
  editor.actions.setForgeToken(' ghp_x ');
  await editor.actions.submitForgeConnect();
  expect(editor.forge.state).toMatchObject({
    open: true,
    pending: false,
    error: 'Bad credentials',
  });
  fail = false;
  await editor.actions.submitForgeConnect();
  expect(post).toHaveBeenLastCalledWith(
    'api/forge/connect',
    { token: 'ghp_x', extra: '' },
    expect.anything(),
  );
  expect(editor.forge.state.open).toBe(false);
  expect(editor.store.state.workspace.meta.forge).toMatchObject({
    hasToken: true,
    source: 'settings',
  });
  expect(toast).toHaveBeenCalledWith('success', 'Connected to GitHub', 3000);
  expect(editor.actions.refreshPRMeta).toHaveBeenCalled();
  dispose();
});
