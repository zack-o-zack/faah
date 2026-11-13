import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { required } from '../lib/test-values.ts';
import { StatusSettings } from './StatusSettings.tsx';

test('status gear opens settings in the desktop shell', () => {
  let editor: EditorStore | undefined;
  document.documentElement.dataset.shell = 'desktop';
  const view = render(() => {
    editor = createEditorStore(createAppStore());
    return (
      <EditorProvider value={editor}>
        <StatusSettings />
      </EditorProvider>
    );
  });
  const gear = screen.getByRole('button', { name: 'Settings' });
  expect(gear.closest('[class*="desktop:hidden"]')).toBeNull();
  fireEvent.click(gear);
  expect(required(editor).store.settings.state.dialog.open).toBe(true);
  view.unmount();
  delete document.documentElement.dataset.shell;
});
