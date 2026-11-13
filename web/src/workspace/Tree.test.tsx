import { required } from '../lib/test-values.ts';
import { createEditorStore } from '../editor/store.ts';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createTreeStore } from './tree-store.ts';
import { Tree } from './Tree.tsx';
import { NewItemDialog } from './NewItemDialog.tsx';
afterEach(() => vi.unstubAllGlobals());
test('renders a bounded window of 20,000 rows and opens its own context menu', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let tree: ReturnType<typeof createTreeStore> | undefined;
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
    const base = createEditorStore(app);
    const editor = { ...base, tree, actions: base.actions };
    return (
      <EditorProvider value={editor}>
        <Tree />
        <NewItemDialog />
      </EditorProvider>
    );
  });
  await required(tree).actions.refreshTree();
  expect(document.querySelectorAll('[role=treeitem]').length).toBeLessThan(100);
  expect(required(document.querySelector('[role=treeitem]')).textContent).toContain('file-0.js');
  fireEvent.contextMenu(required(document.querySelector('[role=treeitem]')), {
    clientX: 10,
    clientY: 10,
  });
  expect(screen.getByRole('menuitem', { name: 'Copy Relative Path' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});
