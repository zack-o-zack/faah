import type { JSX } from 'solid-js';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { HoverDiagnostic } from './HoverDiagnostic.tsx';
import { HoverAction } from './HoverAction.tsx';
import { useEditor } from './context.tsx';
import { nearCard, placeCard } from './hover.ts';
import { copyText } from '../lib/clipboard.ts';

export function HoverCard(): JSX.Element {
  const editor = useEditor();
  let card: HTMLDivElement | undefined;
  createEffect(
    on(
      () => editor.ui.hover,
      () => {
        const element = card;
        if (!editor.ui.hover || !element) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let rect: DOMRect | undefined;
        const track = (event: MouseEvent | null) => {
          const point = event ? { x: event.clientX, y: event.clientY } : null;
          rect ||= element.getBoundingClientRect();
          if (
            element.contains(document.activeElement) ||
            nearCard(point, editor.ui.hoverPosition, rect)
          ) {
            clearTimeout(timer);
            timer = undefined;
          } else if (!timer) timer = setTimeout(editor.actions.hideHover, 340);
        };
        const outside = (event: PointerEvent) => {
          if (event.target instanceof Node && !element.contains(event.target))
            editor.actions.hideHover();
        };
        const blur = () => track(null);
        document.addEventListener('mousemove', track, true);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('blur', blur);
        element.addEventListener('focusout', blur);
        onCleanup(() => {
          clearTimeout(timer);
          document.removeEventListener('mousemove', track, true);
          document.removeEventListener('pointerdown', outside);
          window.removeEventListener('blur', blur);
          element.removeEventListener('focusout', blur);
        });
      },
    ),
  );
  const [position, setPosition] = createSignal({ left: 8, top: 8 });
  createEffect(() => {
    const hover = editor.ui.hover;
    if (!hover || !card || !editor.ui.hoverPosition) return;
    const parent = card.offsetParent;
    if (!(parent instanceof HTMLElement)) return;
    const host = parent.getBoundingClientRect();
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
      class="card absolute z-[60] w-[calc(100%_-_24px)] max-w-[560px] max-h-[min(70vh,calc(100%_-_16px))] overflow-auto gap-0 py-0"
      style={{ left: `${position().left}px`, top: `${position().top}px` }}
    >
      <Show when={editor.ui.hover}>
        {(hover) => (
          <>
            <For each={hover().diagnostics}>
              {(diagnostic) => <HoverDiagnostic diagnostic={diagnostic} />}
            </For>
            <Show when={hover().data.signature}>
              <div
                data-ui="sig"
                class="whitespace-pre-wrap wrap-anywhere px-3 py-2 font-mono text-xs"
                // eslint-disable-next-line solid/no-innerhtml, no-restricted-syntax -- Server-highlighted signature.
                innerHTML={hover().data.signature || ''}
              />
            </Show>
            <Show when={hover().data.doc}>
              <div
                data-ui="doc"
                class="max-h-60 overflow-auto whitespace-pre-wrap wrap-anywhere px-3 pb-2 text-sm text-muted-foreground"
              >
                {hover().data.doc}
              </div>
            </Show>
            <footer
              data-ui="actions"
              class="flex flex-wrap items-center gap-0.5 border-t px-1.5 py-1"
            >
              <HoverAction
                id="hc-def-src"
                title="Jump to definition"
                onAction={() => {
                  editor.actions.gotoDefinition(hover().at, { view: 'source' });
                  editor.actions.hideHover();
                }}
              >
                Definition
              </HoverAction>
              <HoverAction
                id="hc-def-diff"
                title="Jump to definition in the diff"
                onAction={() => {
                  editor.actions.gotoDefinition(hover().at, { view: 'diff' });
                  editor.actions.hideHover();
                }}
              >
                In diff
              </HoverAction>
              <HoverAction
                id="hc-find-refs"
                title="Find all usages"
                onAction={() => editor.actions.findReferences(hover().at)}
              >
                Usages
              </HoverAction>
              <HoverAction
                id="hc-calls"
                title="Trace callers and callees"
                onAction={() => editor.actions.showCalls(hover().at)}
              >
                Calls
              </HoverAction>
              <HoverAction
                id="hc-copy-ref"
                title="Copy file and line reference"
                onAction={() => void copyText(`${hover().at.path}:${hover().at.line}`)}
              >
                Copy ref
              </HoverAction>
              <HoverAction
                id="hc-copy-ai"
                title="Copy the line with its file path and line number"
                onAction={() =>
                  editor.actions.runSelectionAction('copy-agent', {
                    path: hover().at.path,
                    l1: hover().at.line,
                    l2: hover().at.line,
                    text: editor.buffer()?.text(hover().at.line - 1) || '',
                  })
                }
              >
                Copy with context
              </HoverAction>
              <span class="ml-auto px-1.5 text-xs text-muted-foreground">
                {hover().data.server || 'lsp'}
              </span>
            </footer>
          </>
        )}
      </Show>
    </div>
  );
}
