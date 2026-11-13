import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { fileInsights, shortRef, visibleFiles } from './logic.ts';
import { LineStats } from './LineStats.jsx';
// The left pane lists files; insights stay hidden until a filter asks for one kind.
export function WalkthroughFiles(props) {
  const review = useEditor().review;
  return (
    <aside
      id="review-understanding-pane"
      class="flex w-80 max-w-1/2 min-h-0 shrink-0 flex-col overflow-hidden border-r"
    >
      <div class="flex flex-col gap-1 px-3 pt-3">
        <span class="text-sm font-semibold">Changed files</span>
        <span class="text-xs text-muted-foreground">
          {props.data.totalFiles || props.data.files.length} files ·{' '}
          <LineStats additions={props.data.totalAdditions} deletions={props.data.totalDeletions} />{' '}
          ·{' '}
          <span class="font-mono">
            {shortRef(props.data.baseRef || 'HEAD')}{' '}
            <span class="icon-[lucide--arrow-right] size-3 align-[-2px]" aria-hidden="true" />{' '}
            {shortRef(props.data.headRef || 'now')}
          </span>
        </span>
      </div>
      <div
        id="review-understanding-content"
        class="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto overscroll-contain px-1.5 py-2"
      >
        <For each={visibleFiles(props.data.files, review.state.filter)}>
          {(file) => <FileCard file={file} />}
        </For>
      </div>
    </aside>
  );
}
function FileCard(props) {
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
        </span>
        <span class="shrink-0 font-mono">
          <LineStats additions={props.file.additions} deletions={props.file.deletions} />
        </span>
      </button>
      <Show when={fileInsights(props.file, review.state.filter).length}>
        <div class="flex flex-col pb-1">
          <For each={fileInsights(props.file, review.state.filter)}>
            {(item) => <InsightRow path={props.file.path} item={item} />}
          </For>
        </div>
      </Show>
    </article>
  );
}
function InsightRow(props) {
  const editor = useEditor();
  const target = () => editor.review.state.target;
  return (
    <button
      type="button"
      title={props.item.text || ''}
      class="flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 pr-2 pl-5 text-left text-xs text-muted-foreground hover:text-foreground"
      classList={{
        'text-foreground': target().path === props.path && target().line === props.item.line,
      }}
      onClick={() => editor.actions.revealWalkthrough(props.path, props.item.line)}
    >
      <span class={`${props.item.kind.icon} size-3 shrink-0`} aria-hidden="true" />
      <span class="shrink-0 font-mono tabular-nums">L{props.item.line}</span>
      <span class="min-w-0 flex-1 truncate">{props.item.explanation || ''}</span>
    </button>
  );
}
