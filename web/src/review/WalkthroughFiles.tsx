import type { WalkthroughReply, WalkthroughFile } from './types.ts';

interface WalkthroughFilesProps {
  data: WalkthroughReply | null | undefined;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { groupedFiles, movedOnly, shortRef, fileCount } from './logic.ts';
import { LineStats } from './LineStats.tsx';
// Group summaries keep the file list easy to scan.
export function WalkthroughFiles(props: WalkthroughFilesProps): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  return (
    <aside
      id="review-files-pane"
      class="flex w-80 max-w-1/2 min-h-0 shrink-0 flex-col overflow-hidden border-r"
    >
      <div class="flex flex-col gap-1 px-3 pt-3">
        <span class="text-sm font-semibold">Changed files</span>
        <Show when={props.data?.hiddenWhitespaceFiles}>
          <span class="text-xs text-muted-foreground">
            {props.data?.hiddenWhitespaceFiles} whitespace-only{' '}
            {props.data?.hiddenWhitespaceFiles === 1 ? 'file' : 'files'} hidden
          </span>
        </Show>
        <span class="text-xs text-muted-foreground">
          {fileCount(props.data?.totalFiles || props.data?.files.length || 0)} ·{' '}
          <LineStats
            additions={props.data?.totalAdditions}
            deletions={props.data?.totalDeletions}
          />{' '}
          ·{' '}
          <span class="font-mono">
            {shortRef(props.data?.baseRef || 'PR base')}{' '}
            <span class="icon-[ph--arrow-right] align-[-2px]" aria-hidden="true" />{' '}
            {shortRef(props.data?.headRef || 'PR head')}
          </span>
        </span>
      </div>
      <div
        id="review-files-content"
        class="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto overscroll-contain px-1.5 py-2"
      >
        <For each={groupedFiles(props.data?.files || [], review.groupFilter())}>
          {(group) => (
            <section>
              <header class="item" data-size="xs">
                <figure>
                  <span class={`${group.icon}`} aria-hidden="true" />
                </figure>
                <section>
                  <h3>
                    {group.label} <span>{group.files.length}</span>
                  </h3>
                </section>
                <aside>
                  <LineStats additions={group.additions} deletions={group.deletions} />
                </aside>
              </header>
              <For each={group.files}>{(file) => <FileCard file={file} />}</For>
            </section>
          )}
        </For>
      </div>
    </aside>
  );
}
function FileCard(props: { file: WalkthroughFile }): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const slash = () => props.file.path.lastIndexOf('/');
  return (
    <article
      class="shrink-0 rounded-md"
      classList={{
        'bg-accent': review.state.activeFile === props.file.path,
        'text-muted-foreground': !!review.state.viewed[props.file.path],
      }}
    >
      <button
        type="button"
        title={props.file.path}
        class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50"
        onClick={() => editor.actions.revealWalkthrough(props.file.path)}
      >
        <span class="min-w-0 flex-1 truncate font-mono">
          <span class="text-muted-foreground">{props.file.path.slice(0, slash() + 1)}</span>
          {props.file.path.slice(slash() + 1)}
          <Show when={props.file.oldPath}>
            <span class="block truncate text-muted-foreground" title={props.file.oldPath}>
              {props.file.oldPath}
            </span>
          </Show>
        </span>
        <span class="shrink-0 font-mono">
          <Show
            when={movedOnly(props.file)}
            fallback={
              <LineStats additions={props.file.additions} deletions={props.file.deletions} />
            }
          >
            <span class="badge" data-variant="secondary">
              <span class="icon-[ph--arrow-line-right] shrink-0" aria-hidden="true" />
              Moved
            </span>
          </Show>
        </span>
      </button>
    </article>
  );
}
