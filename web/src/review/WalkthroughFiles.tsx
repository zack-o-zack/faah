import type { WalkthroughReply, WalkthroughFile } from './types.ts';

interface WalkthroughFilesProps {
  data: WalkthroughReply | null | undefined;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { groupedFiles, movedOnly, shortRef } from './logic.ts';
import { LineStats } from './LineStats.tsx';
// Group summaries keep the file list easy to scan.
export function WalkthroughFiles(props: WalkthroughFilesProps): JSX.Element {
  const review = useEditor().review;
  return (
    <aside
      id="review-files-pane"
      class="flex w-80 max-w-1/2 min-h-0 shrink-0 flex-col overflow-hidden border-r"
    >
      <div class="flex flex-col gap-1 px-3 pt-3">
        <span class="text-sm font-semibold">Changed files</span>
        <span class="text-xs text-muted-foreground">
          {props.data?.totalFiles || props.data?.files.length || 0} files ·{' '}
          <LineStats
            additions={props.data?.totalAdditions}
            deletions={props.data?.totalDeletions}
          />{' '}
          ·{' '}
          <span class="font-mono">
            {shortRef(props.data?.baseRef || 'HEAD')}{' '}
            <span class="icon-[lucide--arrow-right] size-3 align-[-2px]" aria-hidden="true" />{' '}
            {shortRef(props.data?.headRef || 'now')}
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
              <div class="flex items-center gap-2 px-2 pt-3 pb-1 text-xs text-muted-foreground">
                <span class={`${group.icon} size-3 shrink-0`} aria-hidden="true" />
                <span class="font-semibold">{group.label}</span>
                <span>{group.files.length}</span>
                <span class="ml-auto">
                  <LineStats additions={group.additions} deletions={group.deletions} />
                </span>
              </div>
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
        'opacity-50': !!review.state.viewed[props.file.path],
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
              Moved
            </span>
          </Show>
        </span>
      </button>
    </article>
  );
}
