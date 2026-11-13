import { onMount, onCleanup, Show } from 'solid-js';
import { useEditor } from './context.jsx';
export function FindBar() {
  const editor = useEditor();
  let input;
  onMount(() => {
    editor.services.find = {
      focus() {
        input.focus();
        input.select();
      },
    };
    onCleanup(() => {
      delete editor.services.find;
    });
  });
  return (
    <div
      id="findbar"
      class={`card absolute top-2 right-2 z-30 flex w-96 max-w-full flex-row flex-wrap
        items-center gap-2`}
      hidden={!editor.ui.findOpen}
    >
      <input
        id="find-input"
        ref={input}
        aria-label="Find in file"
        type="text"
        spellcheck={false}
        placeholder="Find"
        autocomplete="off"
        class="input min-w-24 flex-1"
        value={editor.ui.query}
        onInput={(event) => editor.actions.query(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!editor.ui.hits.length) void editor.actions.executeFind();
            else editor.actions.nextMatch(event.shiftKey ? -1 : 1);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            editor.actions.clearFind();
          }
        }}
      />
      <div class="ml-auto flex items-center gap-1">
        <button
          id="find-case"
          class="btn"
          aria-pressed={editor.ui.caseSensitive}
          onClick={editor.actions.toggleFindCase}
          data-variant="outline"
          data-size="xs"
        >
          Aa
        </button>
        <Show when={editor.ui.findError}>
          <span role="alert">{editor.ui.findError}</span>
        </Show>
        <span
          id="find-count"
          aria-busy={editor.ui.findLoading}
          class="min-w-16 text-right font-mono text-muted-foreground"
        >
          {editor.ui.hits.length ? `${editor.ui.activeHit + 1} / ${editor.ui.hits.length}` : '0'}
        </span>
        <button
          id="find-prev"
          class="btn"
          aria-label="Previous match"
          onClick={() => editor.actions.nextMatch(-1)}
          data-variant="ghost"
          data-size="icon-xs"
        >
          <span class="icon-[lucide--arrow-up] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          id="find-next"
          class="btn"
          aria-label="Next match"
          onClick={() => editor.actions.nextMatch(1)}
          data-variant="ghost"
          data-size="icon-xs"
        >
          <span class="icon-[lucide--arrow-down] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          id="find-close"
          class="btn"
          aria-label="Close find"
          onClick={editor.actions.clearFind}
          data-variant="ghost"
          data-size="icon-xs"
        >
          <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
