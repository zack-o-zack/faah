import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from './store.ts';
import { EditorProvider } from './context.tsx';
import { decodeHover } from './decode.ts';
import { HoverCard } from './HoverCard.tsx';

test('symbol hover preserves highlighted signatures and compact actions dispatch their target', () => {
  const references = vi.fn();
  const at = { path: 'main.go', line: 3, col: 5, word: 'main' };
  const view = render(() => {
    const editor = createEditorStore(createAppStore());
    editor.actions.findReferences = references;
    editor.setUI({
      hover: {
        at,
        data: {
          signature: '<i class="k">func</i> main()',
          doc: 'Entry point',
          server: 'gopls',
          state: 'ready',
          empty: false,
        },
        diagnostics: [],
        focus: false,
      },
      hoverPosition: { x: 20, y: 20 },
    });
    return (
      <EditorProvider value={editor}>
        <HoverCard />
      </EditorProvider>
    );
  });
  expect(view.container.querySelector('[data-ui="sig"] .k')?.textContent).toBe('func');
  expect(screen.getByText('gopls')).toBeTruthy();
  const actions = screen.getAllByRole('button');
  expect(actions.map((button) => button.textContent?.trim())).toEqual([
    'Definition',
    'In diff',
    'Usages',
    'Calls',
    'Copy ref',
    'Copy with context',
  ]);
  for (const button of actions) {
    expect(button.dataset.variant).toBe('ghost');
    expect(button.dataset.size).toBe('xs');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Usages' }));
  expect(references).toHaveBeenCalledWith(at);
});

test('keyboard focus keeps a card open after pointer departure and focusout releases it', async () => {
  vi.useFakeTimers();
  const hideHover = vi.fn();
  try {
    render(() => {
      const editor = createEditorStore(createAppStore());
      editor.setUI({
        hover: {
          at: { path: 'a.go', word: 'name', line: 1, col: 0 },
          data: decodeHover({ doc: 'Documentation' }),
          diagnostics: [],
          focus: false,
        },
        hoverPosition: { x: 0, y: 0 },
      });
      return (
        <EditorProvider value={{ ...editor, actions: { ...editor.actions, hideHover } }}>
          <HoverCard />
        </EditorProvider>
      );
    });
    const card = screen.getByRole('region', { name: 'Symbol documentation' });
    card.focus();
    fireEvent.mouseMove(document, { clientX: 9999, clientY: 9999 });
    await vi.advanceTimersByTimeAsync(400);
    expect(hideHover).not.toHaveBeenCalled();
    card.blur();
    await vi.advanceTimersByTimeAsync(400);
    expect(hideHover).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
