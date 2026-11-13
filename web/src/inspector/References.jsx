import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ResultGroup } from '../search/ResultGroup.jsx';
export function References() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <div class="min-h-0 flex-1 overflow-auto" id="right-refs-list">
      <p class="p-2 text-xs" id="right-ref-target">
        {language.state.refs?.word || 'Select or click a symbol to inspect references.'}
      </p>
      <Show when={language.references.loading}>
        <p>Finding references…</p>
      </Show>
      <Show when={language.references.error}>
        <p role="alert">{language.references.error.message}</p>
      </Show>
      <Show when={!language.references.error && language.references()}>
        {(data) => (
          <>
            <p class="p-2 text-xs">{data().header || `${data().total || 0} references`}</p>
            <For each={data().results}>
              {(file) => <ResultGroup file={file} query={language.state.refs?.word} />}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}
