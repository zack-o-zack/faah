interface CommitFilesProps {
  sha: string;
  unpushed?: boolean;
  author?: string;
  date?: string;
}
import type { JSX } from 'solid-js';
import { createResource, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { filePage } from './logic.ts';
export function CommitFiles(props: CommitFilesProps): JSX.Element {
  const editor = useEditor();
  const [shown, setShown] = createSignal(100);
  const [files] = createResource(() => props.sha, editor.actions.loadCommitFiles);
  return (
    <div class={props.unpushed ? 'up-files' : 'git-commit-files ml-3 flex flex-col border-l pl-1'}>
      <Show when={!props.unpushed}>
        <div class="git-commit-meta truncate px-3 py-1 text-xs text-muted-foreground">
          {props.author} · {props.date}
        </div>
      </Show>
      <Show when={files.loading}>
        <p>Loading files…</p>
      </Show>
      <Show when={files.error}>
        <p role="alert">{files.error.message}</p>
      </Show>
      <For each={filePage(files.error ? [] : files() || [], shown())}>
        {(file) => (
          <div
            role="button"
            tabindex="0"
            class="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:bg-accent [&.sel]:bg-accent"
            data-commit-file
            data-path={file.path}
            classList={{
              sel: editor.active()?.path === file.path && editor.active()?.diffRef === props.sha,
            }}
            title={`${file.path}${file.from ? ' (was ' + file.from + ')' : ''}`}
            onClick={() => void editor.actions.openCommitFile(props.sha, file)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              void editor.actions.openCommitFile(props.sha, file);
            }}
          >
            <span class="min-w-0 shrink truncate">{file.path.split('/').pop()}</span>
            <span class="min-w-0 flex-1 truncate text-muted-foreground">
              {file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}
            </span>
            <span class="grid shrink-0 grid-cols-[5ch_5ch] gap-1 text-right font-mono tabular-nums">
              <Show
                when={!file.binary}
                fallback={<span class="col-span-2 text-muted-foreground">bin</span>}
              >
                <span class="text-gi">{file.add ? '+' + file.add : ''}</span>
                <span class="text-gd">{file.del ? '−' + file.del : ''}</span>
              </Show>
            </span>
            <span
              class="gs w-3 shrink-0 text-center font-mono [&.git-M]:text-primary-text [&.git-R]:text-primary-text [&.git-A]:text-gi [&.git-untracked]:text-gi [&.git-D]:text-gd"
              classList={{
                'git-M': file.status === 'M',
                'git-A': file.status === 'A',
                'git-D': file.status === 'D',
                'git-R': file.status === 'R',
              }}
            >
              {file.status}
            </span>
          </div>
        )}
      </For>
      <Show when={shown() < (files.error ? 0 : files()?.length || 0)}>
        <button
          class="btn w-full"
          data-control="up-more"
          data-variant="ghost"
          data-size="xs"
          onClick={() => setShown(shown() + 100)}
        >
          Show {Math.min(100, (files()?.length || 0) - shown())} more
        </button>
      </Show>
      <Show when={!files.error && files() && (files()?.length || 0) === 0}>
        <p>No file changes</p>
      </Show>
    </div>
  );
}
