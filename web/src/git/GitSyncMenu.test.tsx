import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import { GitSyncMenu } from './GitSyncMenu.tsx';

test('sync menu is a separate outlined action and opening it never syncs', () => {
  const sync = vi.fn();
  render(() => {
    const base = createEditorStore(createAppStore());
    const editor = { ...base, actions: { ...base.actions, syncGit: sync } };
    return (
      <EditorProvider value={editor}>
        <GitSyncMenu />
      </EditorProvider>
    );
  });
  const action = screen.getByRole<HTMLButtonElement>('button', { name: 'git sync' });
  const menu = screen.getByRole<HTMLButtonElement>('button', { name: 'Sync actions' });
  expect(action.dataset.variant).toBe('outline');
  expect(menu.dataset.variant).toBe('outline');
  fireEvent.click(menu);
  expect(menu.getAttribute('aria-expanded')).toBe('true');
  expect(sync).not.toHaveBeenCalled();
  expect(screen.getByRole('menuitem', { name: /git pull/ })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(action);
  expect(sync).toHaveBeenCalledTimes(1);
});
