import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ResultGroup } from '../search/ResultGroup.jsx';
export function References() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <>
      <div class="inspector-bar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs has-[#right-ref-target:empty]:hidden">
        <span class="inspector-sym-title truncate font-mono font-semibold" id="right-ref-target">
          {language.state.refs?.word || ''}
        </span>
        <span
          class="badge"
          data-variant="secondary"
          data-control="inspector-badge"
          id="right-ref-badge"
        >
          {language.references()?.total || ''}
        </span>
      </div>
      <div class="panel-body min-h-0 flex-1 overflow-auto pb-4" id="right-refs-list">
        <Show when={!language.state.refs}>
          <div data-ui="hint" class="empty text-muted-foreground">
            Select or click a symbol to inspect references.
          </div>
        </Show>
        <Show when={language.references.loading}>
          <div data-ui="hint" class="empty text-muted-foreground">
            Finding references…
          </div>
        </Show>
        <Show when={language.references.error}>
          <p role="alert">{language.references.error.message}</p>
        </Show>
        <Show when={!language.references.error && language.references()}>
          {(data) => (
            <>
              <div data-ui="hint" class="empty text-muted-foreground">
                {data().header || `${data().total || 0} references`}
              </div>
              <For each={data().results}>
                {(file) => <ResultGroup file={file} query={language.state.refs?.word} />}
              </For>
            </>
          )}
        </Show>
      </div>
    </>
  );
}
