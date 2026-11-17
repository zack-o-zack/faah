import type { JSX } from 'solid-js';
import { onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { forgeInfo, PR_STATES, prEnded, prState } from './logic.ts';
import { MergePill } from './MergePill.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import { MergeControls } from './MergeControls.tsx';
export function PRBar(): JSX.Element {
  const editor = useEditor();
  const pr = () => editor.pr.meta() || {};
  const forge = () => forgeInfo(editor.store.state.workspace.meta);
  const state = () => PR_STATES[prState(pr())];
  const connectHint = () => {
    const hint = (forge().tokenHint || '').trim().replace(/[.!?]$/, '');
    return hint
      ? hint.charAt(0).toUpperCase() + hint.slice(1) + '. Click to connect.'
      : 'Click to connect.';
  };
  const reviewShown = () => !prEnded(pr()) || editor.pr.state.drafts.length > 0;
  onMount(() => {
    const focus = () => editor.actions.refreshStaleMergeStatus();
    window.addEventListener('focus', focus);
    onCleanup(() => window.removeEventListener('focus', focus));
  });
  return (
    <div
      id="pr-bar"
      class="[body:not(.in-review-mode)_&]:hidden! flex flex-none flex-wrap items-center bg-sidebar gap-x-3 gap-y-2 px-3 py-2"
    >
      <div class="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
        <div class="flex min-w-0 items-center gap-2">
          <span
            id="pr-state-badge"
            class="badge shrink-0 gap-1 rounded-pill py-0.5 pl-1.75 pr-2.25 text-xs font-semibold"
            data-tone={state().tone}
          >
            <span class={`${state().icon} shrink-0`} aria-hidden="true" />
            <span>{state().label}</span>
          </span>
          <a
            id="pr-link"
            class="group flex min-w-0 items-center gap-2 rounded-sm"
            href={pr()?.url || '#'}
            title={'Open on ' + forge().label}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span
              id="pr-title"
              class="min-w-0 truncate text-lg/5 font-medium underline-offset-4 group-hover:underline group-focus-visible:underline"
              title={pr()?.title}
            >
              {pr()?.title}
            </span>
            <span id="pr-number" class="shrink-0 text-lg/5 tabular-nums text-muted-foreground">
              #{pr().number}
            </span>
            <span
              aria-hidden="true"
              class="icon-[ph--arrow-square-out] shrink-0 text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground"
            />
          </a>
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span id="pr-refs" class="inline-flex min-w-0 shrink-[4] items-center gap-1.5">
            <code
              class="min-w-0 truncate rounded-sm border border-border bg-card px-1.5 font-mono text-foreground"
              title={pr().head}
            >
              {pr().head}
            </code>
            <span class="icon-[ph--arrow-right] shrink-0" aria-hidden="true" />
            <code
              class="min-w-0 truncate rounded-sm border border-border bg-card px-1.5 font-mono text-foreground"
              title={pr().base}
            >
              {pr().base}
            </code>
          </span>
          <Show when={!prEnded(pr())}>
            <MergePill />
          </Show>
          <Show when={pr().diffBaseWarning}>
            <span
              id="pr-diff-warning"
              class="inline-flex shrink-0 items-center gap-1 text-destructive"
              title={pr().diffBaseWarning}
            >
              <span class="icon-[ph--warning] shrink-0" aria-hidden="true" />
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
              title={connectHint()}
              onClick={() => editor.actions.openForgeConnect()}
              data-control="pr-readonly-note"
            >
              <span class="icon-[ph--key] shrink-0" aria-hidden="true" />
              Connect {forge().label}
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
function MergeFix(): JSX.Element {
  const editor = useEditor();
  const pill = () => editor.merge.pill();
  return (
    <Show when={pill()?.act}>
      <button
        id="pr-merge-fix"
        type="button"
        class="btn"
        data-variant={pill()?.act === 'resolve' ? 'special' : 'outline'}
        data-size="sm"
        title={pill()?.title}
        disabled={editor.merge.sync().running}
        onClick={editor.actions.runMergeFix}
      >
        <span
          class={`${pill()?.act === 'resolve' ? 'icon-[ph--spinner]' : 'icon-[ph--arrow-up]'} shrink-0`}
          aria-hidden="true"
        />
        {pill()?.fix}
      </button>
    </Show>
  );
}
function BatchApply(): JSX.Element {
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
        <span class="icon-[ph--spinner] shrink-0" aria-hidden="true" />
        <span>{batch().pending ? `Applying… ${batch().seconds}s` : 'Apply drafts'}</span>
      </button>
    </Show>
  );
}
