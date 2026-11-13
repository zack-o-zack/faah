import { createMemo, createResource, onCleanup, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { api } from '../lib/api.ts';
import { commitStepTarget } from './diff-rows.ts';

export function DiffStrip(props) {
  const editor = useEditor();
  let request;
  onCleanup(() => request?.abort());
  const [commit] = createResource(
    () => (props.document.diffRef && !props.document.turnFiles ? props.document.diffRef : false),
    (sha) => {
      request?.abort();
      request = new AbortController();
      return api('api/commitfiles', { sha }, { signal: request.signal });
    },
  );
  const files = createMemo(() => {
    if (props.document.turnFiles)
      return props.document.turnFiles.map((file) =>
        typeof file === 'string' ? { path: file } : file,
      );
    if (props.document.diffRef) return commit()?.files || [];
    return (editor.store.state.workspace.meta?.gitFiles || []).map((path) => ({ path }));
  });
  const index = () => files().findIndex((file) => file.path === props.document.path);
  function step(direction) {
    const next = files()[commitStepTarget(files(), index(), direction)];
    if (next) editor.actions.stepDiffFile(props.document, next);
  }
  function viewed() {
    editor.actions.toggleViewed(props.document.path);
    if (!editor.store.state.viewers.viewed[props.document.path]) return;
    const after = [...files().slice(index() + 1), ...files().slice(0, Math.max(0, index()))];
    const next = after.find(
      (file) => !file.binary && !editor.store.state.viewers.viewed[file.path],
    );
    if (next) editor.actions.stepDiffFile(props.document, next);
  }
  return (
    <div
      data-ui="diff-commit-strip"
      class="diff-review-strip flex items-center gap-2 p-3 font-mono"
    >
      <span data-ui="dcs-path" class="min-w-0 truncate text-muted-foreground">
        {props.document.path}
      </span>
      <span class="flex-1" />
      <button
        class="btn"
        data-control="dcs-step dcs-hunk-btn"
        data-variant="outline"
        data-size="xs"
        data-hunk-step="-1"
        onClick={() => props.stepHunk(-1)}
      >
        <span class="icon-[lucide--arrow-up] size-3.5" aria-hidden="true" /> Hunk
      </button>
      <button
        class="btn"
        data-control="dcs-step dcs-hunk-btn"
        data-variant="outline"
        data-size="xs"
        data-hunk-step="1"
        onClick={() => props.stepHunk(1)}
      >
        <span class="icon-[lucide--arrow-down] size-3.5" aria-hidden="true" /> Hunk
      </button>
      <button
        class="btn"
        data-size="xs"
        data-toggle-viewed="1"
        data-control="dcs-viewed"
        data-variant={
          editor.store.state.viewers.viewed[props.document.path] ? 'secondary' : 'ghost'
        }
        aria-pressed={!!editor.store.state.viewers.viewed[props.document.path]}
        onClick={viewed}
      >
        <span class="icon-[lucide--check] size-3.5" aria-hidden="true" /> Viewed
      </button>
      <Show when={commit.loading}>
        <span role="status">Loading commit files…</span>
      </Show>
      <Show when={commit.error}>
        <span role="alert">Unable to load commit files: {commit.error?.message}</span>
      </Show>
      <Show when={files().length}>
        <span data-ui="dcs-pos" class="flex-none text-muted-foreground">
          {index() + 1} / {files().length}
        </span>
        <button
          class="btn"
          data-size="icon-xs"
          data-variant="ghost"
          data-control="dcs-step"
          aria-label="Previous file"
          data-review-step="-1"
          disabled={commitStepTarget(files(), index(), -1) < 0}
          onClick={() => step(-1)}
        >
          <span class="icon-[lucide--chevron-left] size-3.5" aria-hidden="true" />
        </button>
        <button
          class="btn"
          data-size="icon-xs"
          data-variant="ghost"
          data-control="dcs-step"
          aria-label="Next file"
          data-review-step="1"
          disabled={commitStepTarget(files(), index(), 1) < 0}
          onClick={() => step(1)}
        >
          <span class="icon-[lucide--chevron-right] size-3.5" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
