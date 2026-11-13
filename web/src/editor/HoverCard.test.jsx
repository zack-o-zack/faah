import { render, screen, fireEvent } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { EditorProvider } from './context.tsx';
import { HoverCard } from './HoverCard.jsx';
test('keyboard focus keeps a card open after pointer departure and focusout releases it', async () => {
  vi.useFakeTimers();
  const hideHover = vi.fn();
  const [ui] = createStore({
    hover: { at: { path: 'a.go' }, data: { doc: 'Documentation' }, diagnostics: [] },
    hoverPosition: { x: 0, y: 0 },
  });
  try {
    render(() => (
      <EditorProvider value={{ ui, actions: { hideHover }, services: {} }}>
        <HoverCard />
      </EditorProvider>
    ));
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
