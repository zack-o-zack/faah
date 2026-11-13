import { render, screen, fireEvent } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from './store.ts';
import { decodeHover } from './decode.ts';
import { EditorProvider } from './context.tsx';
import { HoverCard } from './HoverCard.tsx';
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
