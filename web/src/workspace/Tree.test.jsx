import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.jsx';
import { createTreeStore } from './tree-store.ts';
import { Tree } from './Tree.jsx';
import { NewItemDialog } from './NewItemDialog.jsx';
afterEach(() => vi.unstubAllGlobals());
test('renders a bounded window of 20,000 rows and opens its own context menu', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let tree;
  const entries = Array.from({ length: 20000 }, (_, i) => ({
    path: `file-${i}.js`,
    name: `file-${i}.js`,
  }));
  render(() => {
    const app = createAppStore();
    tree = createTreeStore(app, {
      request: async () => ({ children: entries }),
      openFile: vi.fn(),
    });
    const editor = { store: app, tree, actions: tree.actions, active: () => null };
    return (
      <EditorProvider value={editor}>
        <Tree />
        <NewItemDialog />
      </EditorProvider>
    );
  });
  await tree.actions.refreshTree();
  expect(document.querySelectorAll('[role=treeitem]').length).toBeLessThan(100);
  expect(document.querySelector('[role=treeitem]').textContent).toContain('file-0.js');
  fireEvent.contextMenu(document.querySelector('[role=treeitem]'), { clientX: 10, clientY: 10 });
  expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});
