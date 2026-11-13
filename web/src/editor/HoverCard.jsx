import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { useEditor } from './context.jsx';
import { nearCard, placeCard } from './hover.js';
import { copyText } from '../lib/clipboard.js';

export function HoverCard() {
  const editor = useEditor();
  let card;
  createEffect(
    on(
      () => editor.ui.hover,
      () => {
        if (!editor.ui.hover) return;
        let timer;
        let rect;
        const track = (event) => {
          const point = event ? { x: event.clientX, y: event.clientY } : null;
          rect ||= card.getBoundingClientRect();
          if (
            card.contains(document.activeElement) ||
            nearCard(point, editor.ui.hoverPosition, rect)
          ) {
            clearTimeout(timer);
            timer = null;
          } else if (!timer) timer = setTimeout(editor.actions.hideHover, 340);
        };
        const outside = (event) => {
          if (!card.contains(event.target)) editor.actions.hideHover();
        };
        const blur = () => track(null);
        document.addEventListener('mousemove', track, true);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('blur', blur);
        card.addEventListener('focusout', blur);
        onCleanup(() => {
          clearTimeout(timer);
          document.removeEventListener('mousemove', track, true);
          document.removeEventListener('pointerdown', outside);
          window.removeEventListener('blur', blur);
          card.removeEventListener('focusout', blur);
        });
      },
    ),
  );
  const [position, setPosition] = createSignal({ left: 8, top: 8 });
  createEffect(() => {
    const hover = editor.ui.hover;
    if (!hover || !card) return;
    const host = { left: 0, top: 0, width: innerWidth, height: innerHeight };
    setPosition(placeCard(editor.ui.hoverPosition, host, card.getBoundingClientRect()));
    if (hover.focus) card.focus();
  });
  // The signature is syntax-highlighted HTML rendered by the server.
  return (
    <div
      id="hovercard"
      ref={card}
      role="region"
      aria-label="Symbol documentation"
      tabindex="-1"
      hidden={!editor.ui.hover}
      class="card fixed z-[60] max-w-[560px] max-h-[70vh] overflow-auto gap-0 py-0"
      style={{ left: `${position().left}px`, top: `${position().top}px` }}
    >
      <Show when={editor.ui.hover}>
        {(hover) => (
          <>
            <For each={hover().diagnostics}>
              {(diagnostic) => (
                <p class="border-b p-3 text-sm text-destructive">{diagnostic.message}</p>
              )}
            </For>
            <div
              class="whitespace-pre-wrap p-3 font-mono text-xs"
              // eslint-disable-next-line solid/no-innerhtml, no-restricted-syntax -- Server-highlighted signature.
              innerHTML={hover().data.signature || ''}
            />
            <p class="whitespace-pre-wrap px-3 pb-2 text-sm">{hover().data.doc}</p>
            <footer class="flex flex-wrap gap-1 border-t p-2">
              <button
                class="btn"
                onClick={() => {
                  editor.actions.gotoDefinition(hover().at, { view: 'source' });
                  editor.actions.hideHover();
                }}
              >
                Definition
              </button>
              <button
                class="btn"
                onClick={() => {
                  editor.actions.gotoDefinition(hover().at, { view: 'diff' });
                  editor.actions.hideHover();
                }}
              >
                In diff
              </button>
              <button class="btn" onClick={() => editor.actions.findReferences(hover().at)}>
                Usages
              </button>
              <button class="btn" onClick={() => editor.actions.showCalls(hover().at)}>
                Calls
              </button>
              <button
                class="btn"
                onClick={() =>
                  editor.actions.runSelectionAction('copy-agent', {
                    path: hover().at.path,
                    l1: hover().at.line,
                    l2: hover().at.line,
                    text: editor.buffer().text(hover().at.line - 1),
                  })
                }
              >
                Copy with Context
              </button>
              <button
                class="btn"
                onClick={() => void copyText(`${hover().at.path}:${hover().at.line}`)}
              >
                Copy Ref
              </button>
            </footer>
          </>
        )}
      </Show>
    </div>
  );
}
