import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createResource } from 'solid-js';
import { createEditorStore } from '../editor/store.ts';
import { testDocument } from '../editor/test-document.ts';
import { decodeSetup } from '../lsp/decode.ts';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { InspectorToolbar } from './InspectorToolbar.tsx';
import { Symbols } from './Symbols.tsx';
import { LspSetup } from '../lsp/LspSetup.tsx';
test('fresh inspector tabs and symbol filtering invoke named navigation actions', () => {
  const centerLine = vi.fn();
  render(() => {
    const app = createAppStore();
    app.actions.showRightInspector('symbols');
    const base = createEditorStore(app);
    const editor = {
      ...base,
      active: () =>
        testDocument({
          path: 'one.js',
          outline: [
            { name: 'alpha', kind: 'func', line: 3, indent: 0 },
            { name: 'beta', kind: 'const', line: 8, indent: 0 },
          ],
        }),
      actions: { ...base.actions, patch: vi.fn(), centerLine },
    };
    return (
      <EditorProvider value={editor}>
        <InspectorToolbar />
        <Symbols />
      </EditorProvider>
    );
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Filter symbols' }), {
    target: { value: 'beta' },
  });
  expect(screen.queryByRole('button', { name: /alpha/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /beta/ }));
  expect(centerLine).toHaveBeenCalledWith(8);
  fireEvent.click(screen.getByRole('tab', { name: 'References' }));
  expect(screen.getByRole('tab', { name: 'References' }).getAttribute('aria-selected')).toBe(
    'true',
  );
});
test('setup explains a disabled language service without offering installation', () => {
  render(() => {
    const base = createEditorStore(createAppStore());
    const [setup] = createResource(async () => decodeSetup({ enabled: false }), {
      initialValue: decodeSetup({ enabled: false }),
    });
    return (
      <EditorProvider value={{ ...base, language: { ...base.language, setup } }}>
        <LspSetup />
      </EditorProvider>
    );
  });
  expect(screen.getByText(/Restart it without that flag/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
});
