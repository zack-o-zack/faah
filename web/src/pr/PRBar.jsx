import { onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { forgeInfo, PR_STATES, prEnded, prState } from './logic.ts';
import { MergePill } from './MergePill.jsx';
import { ReviewPanel } from './ReviewPanel.jsx';
import { MergeControls } from './MergeControls.jsx';
export function PRBar() {
  const editor = useEditor();
  const pr = () => editor.pr.meta();
  const forge = () => forgeInfo(editor.store.state.workspace.meta);
  const state = () => PR_STATES[prState(pr())];
  const reviewShown = () => !prEnded(pr()) || editor.pr.state.drafts.length > 0;
  onMount(() => {
    const focus = () => editor.actions.refreshStaleMergeStatus();
    window.addEventListener('focus', focus);
    onCleanup(() => window.removeEventListener('focus', focus));
  });
  return (
    <div
      id="pr-bar"
      class="[body:not(.in-review-mode)_&]:hidden! flex flex-none flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
    >
      <div class="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-2">
          <a
            id="pr-link"
            class="group flex items-center min-w-40 gap-2 rounded-md -mx-1.5 px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={pr().url || '#'}
            title={'Open on ' + forge().label}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span
              id="pr-badge"
              class="badge shrink-0 tabular-nums"
              data-variant="secondary"
              data-control="pr-badge"
            >
              #{pr().number}
            </span>
            <span
              id="pr-title"
              class="min-w-0 truncate text-sm font-medium underline-offset-4 group-hover:underline group-focus-visible:underline"
              title={pr().title}
            >
              {pr().title}
            </span>
            <span class="icon-[lucide--external-link] size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground" />
          </a>
          <span
            id="pr-state-badge"
            class={`badge gap-1 border-current/30 bg-current/10 ${state().color}`}
            data-variant="outline"
          >
            <span class={`${state().icon} size-3 shrink-0`} aria-hidden="true" />
            <span class="text-foreground">{state().label}</span>
          </span>
        </div>
        <div class="flex min-w-0 items-center gap-3 pl-px text-xs text-muted-foreground">
          <span id="pr-refs" class="min-w-0 shrink-[4] truncate font-mono">
            {pr().base}{' '}
            <span class="icon-[lucide--arrow-left] size-3 align-[-2px]" aria-hidden="true" />{' '}
            {pr().head}
          </span>
          <MergePill />
          <Show when={pr().diffBaseWarning}>
            <span
              id="pr-diff-warning"
              class="inline-flex shrink-0 items-center gap-1 text-destructive"
              title={pr().diffBaseWarning}
            >
              <span class="icon-[lucide--triangle-alert] size-3.5 shrink-0" aria-hidden="true" />
              Diff base differs
            </span>
          </Show>
          <Show when={pr().readOnly}>
            <button
              id="pr-readonly-note"
              type="button"
              class="btn"
              data-variant="outline"
              data-size="xs"
              title={
                forge().tokenHint[0].toUpperCase() +
                forge().tokenHint.slice(1) +
                ' -- or click to connect'
              }
              onClick={() => editor.actions.openForgeConnect()}
              data-control="pr-readonly-note"
            >
              No {forge().label} token — click to connect
            </button>
          </Show>
        </div>
      </div>
      <div id="pr-review-row" class="ml-auto flex shrink-0 items-center gap-2">
        <MergeFix />
        <BatchApply />
        <Show when={reviewShown()}>
          <ReviewPanel />
        </Show>
        <Show when={reviewShown() && editor.merge.canMerge()}>
          <span class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        </Show>
        <Show when={editor.merge.canMerge()}>
          <MergeControls />
        </Show>
      </div>
    </div>
  );
}
// The fix is a button of its own beside Review, so it reads as something to press.
function MergeFix() {
  const editor = useEditor();
  const pill = () => editor.merge.pill();
  return (
    <Show when={pill()?.act}>
      <button
        id="pr-merge-fix"
        type="button"
        class="btn"
        data-variant={pill().act === 'resolve' ? 'special' : 'outline'}
        data-size="sm"
        title={pill().title}
        disabled={editor.merge.sync().running}
        onClick={editor.actions.runMergeFix}
      >
        <span
          class={`${pill().act === 'resolve' ? 'icon-[lucide--sparkle]' : 'icon-[lucide--arrow-up]'} size-3.5 shrink-0`}
          aria-hidden="true"
        />
        {pill().fix}
      </button>
    </Show>
  );
}
function BatchApply() {
  const editor = useEditor();
  const batch = () => editor.pr.state.batch;
  return (
    <Show when={editor.pr.applicable().length || batch().pending || batch().error}>
      <button
        id="pr-batch-apply"
        title={batch().error || 'Have the harness apply your draft comments to the code'}
        class="btn"
        classList={{ 'text-destructive': !!batch().error }}
        data-variant="special"
        data-size="sm"
        disabled={batch().pending || !editor.pr.applicable().length}
        onClick={() => void editor.actions.applyDrafts()}
        data-control="bar-action pr-btn-batch-apply"
      >
        <span class="icon-[lucide--sparkle] size-3.5 shrink-0" aria-hidden="true" />
        <span>{batch().pending ? `Applying… ${batch().seconds}s` : 'Apply drafts'}</span>
      </button>
    </Show>
  );
}
