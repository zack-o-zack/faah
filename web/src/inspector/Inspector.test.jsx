import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.js';
import { EditorProvider } from '../editor/context.jsx';
import { InspectorToolbar } from './InspectorToolbar.jsx';
import { Symbols } from './Symbols.jsx';
import { LspSetup } from '../lsp/LspSetup.jsx';
test('fresh inspector tabs and symbol filtering invoke named navigation actions', () => {
  const centerLine = vi.fn();
  render(() => {
    const app = createAppStore();
    app.actions.showRightInspector('symbols');
    const [symbolResource] = createSignal([]);
    const editor = {
      store: app,
      active: () => ({
        path: 'one.js',
        outline: [
          { name: 'alpha', kind: 'func', line: 3 },
          { name: 'beta', kind: 'const', line: 8 },
        ],
      }),
      actions: { ...app.actions, patch: vi.fn(), centerLine },
      language: { symbols: symbolResource },
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
  render(() => (
    <EditorProvider
      value={{ language: { setup: () => ({ enabled: false }), state: {} }, active: () => null }}
    >
      <LspSetup />
    </EditorProvider>
  ));
  expect(screen.getByText(/Restart without -no-lsp/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
});
