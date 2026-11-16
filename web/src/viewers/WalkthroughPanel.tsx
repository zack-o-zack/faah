import type { JSX } from 'solid-js';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ButtonKbd } from '../lib/ButtonKbd.tsx';
import { Markdown } from '../lib/Markdown.tsx';
import { pluralize } from '../pr/logic.ts';

export function WalkthroughPanel(): JSX.Element {
  const editor = useEditor();
  const state = editor.store.state.explanation;
  const [selected, setSelected] = createSignal(0);
  const index = () => state.walk?.index ?? selected();
  const walkthrough = () => state.model?.walkthroughs[index()] || state.model?.walkthroughs[0];
  const step = editor.walkthrough.step;
  const files = () => new Set(walkthrough()?.steps.map((step) => step.path)).size;
  let panel: HTMLElement | undefined;
  function focus() {
    panel?.focus({ preventScroll: true });
  }
  onMount(() => {
    const service = { focus };
    editor.services.walkthrough = service;
    onCleanup(() => {
      if (editor.services.walkthrough === service) delete editor.services.walkthrough;
    });
  });
  function start() {
    editor.actions.walkStart(index());
    queueMicrotask(focus);
  }
  function stop() {
    setSelected(index());
    editor.actions.walkStop();
    queueMicrotask(focus);
  }
  function move(delta: -1 | 1) {
    if (!state.walk && delta === 1) start();
    else editor.actions.walkMove(delta);
    queueMicrotask(focus);
  }
  function onArrow(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest('select, input, textarea')) return;
    if (!state.walk && event.key === 'ArrowLeft') return;
    event.preventDefault();
    event.stopPropagation();
    move(event.key === 'ArrowRight' ? 1 : -1);
  }
  const warning = () => {
    if (editor.walkthrough.missing()) return 'file not found';
    return editor.walkthrough.outdated() ? 'may be outdated' : '';
  };
  const refs = () =>
    editor.threads.state.records[state.model?.id || '']?.turns.find(
      (turn) => turn.id === state.model?.turn,
    )?.refs || {};
  return (
    <>
      <section
        ref={panel}
        id="walkthrough-panel"
        tabindex="-1"
        aria-label="Walkthrough"
        class="flex min-w-0 flex-col gap-3 border-t pt-3"
        onKeyDown={onArrow}
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="icon-[ph--path] size-3.5 shrink-0 text-special" aria-hidden="true" />
          <Show
            when={!state.compact && (state.model?.walkthroughs.length || 0) > 1}
            fallback={
              <span
                class={
                  step()
                    ? 'min-w-0 flex-1 truncate text-xs text-muted-foreground'
                    : 'min-w-0 flex-1 truncate text-sm font-medium'
                }
                title={state.compact ? step()?.title || walkthrough()?.title : walkthrough()?.title}
              >
                {state.compact ? step()?.title || walkthrough()?.title : walkthrough()?.title}
              </span>
            }
          >
            <select
              class="select h-7 min-w-0 flex-1 truncate text-xs"
              aria-label="Choose walkthrough"
              title={walkthrough()?.title}
              value={index()}
              onChange={(event) => {
                const next = +event.currentTarget.value;
                setSelected(next);
                if (state.walk) {
                  editor.actions.walkStart(next);
                  queueMicrotask(focus);
                }
              }}
            >
              <For each={state.model?.walkthroughs}>
                {(walkthrough, index) => <option value={index()}>{walkthrough.title}</option>}
              </For>
            </select>
          </Show>
          <Show when={state.compact && !step()}>
            <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
              {pluralize(walkthrough()?.steps.length || 0, 'step')}
            </span>
          </Show>
          <Show when={step()}>
            {(step) => (
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                {step().n} / {step().of}
              </span>
            )}
          </Show>
          <Show when={state.compact}>
            <Show when={warning()}>
              <span title={warning()} class="flex shrink-0 items-center text-warn">
                <span class="icon-[ph--warning] size-3.5" aria-hidden="true" />
                <span class="sr-only">{warning()}</span>
              </span>
            </Show>
            <button
              class="btn shrink-0"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="Previous"
              title="Previous (←)"
              disabled={!step() || step()?.n === 1}
              onClick={() => move(-1)}
            >
              <span class="icon-[ph--caret-left] size-3.5" />
            </button>
            <button
              class="btn shrink-0"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label={step()?.n === step()?.of && step() ? 'Done' : 'Next'}
              title={step()?.n === step()?.of && step() ? 'Done (→)' : 'Next (→)'}
              disabled={!walkthrough()?.steps.length}
              onClick={() => (step() && step()?.n === step()?.of ? stop() : move(1))}
            >
              <span
                class={
                  step() && step()?.n === step()?.of
                    ? 'icon-[ph--check] size-3.5'
                    : 'icon-[ph--caret-right] size-3.5'
                }
              />
            </button>
          </Show>
        </div>
        <Show
          when={step()}
          fallback={
            <Show when={!state.compact}>
              <p class="text-xs text-muted-foreground">
                {pluralize(walkthrough()?.steps.length || 0, 'step')} · {pluralize(files(), 'file')}
              </p>
            </Show>
          }
        >
          {(step) => (
            <>
              {/* Basecoat has no progress component; keep the track and reduced-motion fill local. */}
              <div
                class="h-0.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Walkthrough progress"
                aria-valuemin={0}
                aria-valuemax={step().of}
                aria-valuenow={step().n}
              >
                <div
                  class="h-full rounded-full bg-special transition-[width] duration-150 motion-reduce:transition-none"
                  style={{ width: `${(step().n / step().of) * 100}%` }}
                />
              </div>
              <Show when={!state.compact}>
                <h3 class="text-sm font-medium text-foreground">{step().title}</h3>
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    class="btn min-w-0 max-w-full font-mono"
                    data-variant="ghost"
                    data-size="xs"
                    title={`${step().path}:${step().l1}-${step().l2}`}
                    onClick={() => {
                      void editor.walkthrough.reveal();
                      queueMicrotask(focus);
                    }}
                  >
                    <span class="truncate">
                      {step().path}:{step().l1}-{step().l2}
                    </span>
                  </button>
                  {/* Vega has no warning badge variant; add the existing warning tokens to its outline badge. */}
                  <Show when={editor.walkthrough.missing()}>
                    <span
                      class="badge border-warn/20 bg-warn/10 text-warn"
                      data-variant="outline"
                      role="status"
                    >
                      file not found
                    </span>
                  </Show>
                  <Show when={editor.walkthrough.outdated()}>
                    <span class="badge border-warn/20 bg-warn/10 text-warn" data-variant="outline">
                      may be outdated
                    </span>
                  </Show>
                </div>
                <div class="max-h-[40vh] overflow-auto text-sm leading-relaxed text-muted-foreground">
                  <Markdown
                    text={step().body}
                    refs={refs()}
                    onOpen={(target) =>
                      editor.review.state.mode === 'review'
                        ? void editor.actions.openReviewReference(target)
                        : void editor.actions.openFile(target.path, {
                            line: target.line,
                            view: 'source',
                          })
                    }
                  />
                </div>
              </Show>
            </>
          )}
        </Show>
      </section>
      <Show when={!state.compact}>
        <footer onKeyDown={onArrow} class="flex flex-wrap items-center justify-between gap-2">
          <Show
            when={step()}
            fallback={
              <button
                class="btn ml-auto"
                data-variant="primary"
                data-size="xs"
                disabled={!walkthrough()?.steps.length}
                onClick={start}
              >
                Start <ButtonKbd combo="Right" />
              </button>
            }
          >
            {(step) => (
              <>
                {/* Cancel Vega xs ghost padding to align End with the section. */}
                <button class="btn -ms-2" data-variant="ghost" data-size="xs" onClick={stop}>
                  End
                </button>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    class="btn"
                    data-variant="outline"
                    data-size="xs"
                    disabled={step().n === 1}
                    onClick={() => move(-1)}
                  >
                    Previous <ButtonKbd combo="Left" />
                  </button>
                  <button
                    class="btn"
                    data-variant="primary"
                    data-size="xs"
                    onClick={() => (step().n === step().of ? stop() : move(1))}
                  >
                    {step().n === step().of ? 'Done' : 'Next'}{' '}
                    <Show when={step().n < step().of}>
                      <ButtonKbd combo="Right" />
                    </Show>
                  </button>
                </div>
              </>
            )}
          </Show>
        </footer>
      </Show>
    </>
  );
}
