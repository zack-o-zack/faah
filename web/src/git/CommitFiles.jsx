import { createResource, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { filePage } from './logic.ts';
export function CommitFiles(props) {
  const editor = useEditor();
  const [shown, setShown] = createSignal(100);
  const [files] = createResource(() => props.sha, editor.actions.loadCommitFiles);
  return (
    <div class="git-commit-files ml-3 border-l pl-1">
      <Show when={files.loading}>
        <p>Loading files…</p>
      </Show>
      <Show when={files.error}>
        <p role="alert">{files.error.message}</p>
      </Show>
      <For each={filePage(files.error ? [] : files() || [], shown())}>
        {(file) => (
          <button
            class="btn flex w-full gap-2 text-left text-xs"
            data-commit-file
            data-path={file.path}
            classList={{
              sel: editor.active()?.path === file.path && editor.active()?.diffRef === props.sha,
            }}
            title={`${file.path}${file.from ? ' (was ' + file.from + ')' : ''}`}
            onClick={() => void editor.actions.openCommitFile(props.sha, file)}
          >
            <span class="min-w-0 flex-1 truncate">{file.path}</span>
            <span class="font-mono text-gi">{file.binary ? 'bin' : '+' + (file.add || 0)}</span>
            <span class="font-mono text-gd">{file.binary ? '' : '−' + (file.del || 0)}</span>
            <span>{file.status}</span>
          </button>
        )}
      </For>
      <Show when={shown() < (files.error ? 0 : files()?.length || 0)}>
        <button class="btn w-full" data-control="up-more" onClick={() => setShown(shown() + 100)}>
          Show {Math.min(100, files().length - shown())} more
        </button>
      </Show>
      <Show when={!files.error && files() && files().length === 0}>
        <p>No file changes</p>
      </Show>
    </div>
  );
}
