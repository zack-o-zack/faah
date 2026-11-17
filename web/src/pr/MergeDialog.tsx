import type { MergeMessage } from './types.ts';

interface CommitFieldsProps {
  draft: MergeMessage;
}
import type { JSX } from 'solid-js';
import { createEffect, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { DropdownMenu } from '../lib/DropdownMenu.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { ButtonKbd } from '../lib/ButtonKbd.tsx';
import { keyLabel } from '../lib/keyboard.ts';
import { AgentPicker } from '../agents/AgentPicker.tsx';
import { mergeMethodInfo } from './logic.ts';
// Shows exactly what lands on the base: method, commit title and message, and what blocks it.
export function MergeDialog(): JSX.Element {
  const editor = useEditor();
  const merge = editor.merge;
  const dialog = () => merge.state.dialog;
  const method = () => mergeMethodInfo(dialog().method);
  const draft = () => dialog().drafts[dialog().method] || { title: '', message: '' };
  const blocked = () => merge.warnings()?.block || '';
  return (
    <Show when={dialog().open}>
      <Dialog
        open={true}
        bare
        id="pr-merge-modal"
        title={`Merge pull request #${editor.pr.meta()?.number}`}
        onClose={editor.actions.closeMergeDialog}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          void editor.actions.confirmMerge();
        }}
      >
        <div class="max-w-[min(42rem,calc(100vw-2rem))] overflow-hidden">
          <header class="flex-row! items-start justify-between gap-4">
            <div class="min-w-0 flex-1 space-y-1">
              <h2 id="pr-merge-title" class="whitespace-nowrap text-base font-semibold">
                Merge pull request #{editor.pr.meta()?.number}
              </h2>
              <p
                id="pr-merge-refs"
                class="truncate font-mono text-sm text-muted-foreground"
                title={`${editor.pr.meta()?.head} → ${merge.base()}`}
              >
                {editor.pr.meta()?.head} → {merge.base()}
              </p>
            </div>
            <button
              class="btn shrink-0"
              data-variant="ghost"
              data-size="icon-xs"
              aria-label="Close (Esc)"
              onClick={editor.actions.closeMergeDialog}
            >
              <span class="icon-[ph--x]" aria-hidden="true" />
            </button>
          </header>
          <section class="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <p id="pr-merge-explain" data-ui="pr-merge-explain" class="text-muted-foreground">
              {method().explain(merge.commitCount(), merge.base())}
            </p>
            <div id="pr-merge-warnings" data-ui="pr-merge-warnings" class="flex flex-col gap-2">
              <Show when={blocked()}>
                <div data-ui="pr-merge-warn" class="alert p-3 block">
                  {blocked()}
                </div>
              </Show>
              <For each={merge.warnings()?.notes || []}>
                {(note) => (
                  <div data-ui="pr-merge-warn" class="alert p-3">
                    {note}
                  </div>
                )}
              </For>
            </div>
            <Show when={dialog().method !== 'rebase'} fallback={<CommitList />}>
              <CommitFields draft={draft()} />
            </Show>
            <ErrorNotice error={dialog().error} />
          </section>
          <footer class="flex-row! flex-wrap items-center gap-3">
            <div class="ml-auto flex items-center gap-2">
              <button
                id="pr-merge-cancel"
                title="Cancel (Esc)"
                aria-keyshortcuts="Escape"
                class="btn"
                data-variant="outline"
                data-size="sm"
                onClick={editor.actions.closeMergeDialog}
              >
                Cancel <ButtonKbd combo="Esc" />
              </button>
              <div class="button-group flex gap-0">
                <button
                  id="pr-merge-confirm"
                  title={`${method().label} (${keyLabel('Mod+Enter')})`}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                  class="btn"
                  data-variant="primary"
                  data-size="sm"
                  disabled={!!blocked() || dialog().pending || dialog().rewriting.pending}
                  onClick={() => void editor.actions.confirmMerge()}
                >
                  {dialog().pending ? 'Merging...' : method().label} <ButtonKbd combo="Mod+Enter" />
                </button>
                <Show when={merge.allowed().length > 1}>
                  <DropdownMenu
                    triggerId="pr-merge-method-caret"
                    accessibleLabel="Choose merge method"
                    variant="primary"
                    size="sm"
                    disabled={dialog().pending || dialog().rewriting.pending}
                    label={<span class="icon-[ph--caret-down]" aria-hidden="true" />}
                    panelClass="fixed z-[70] m-0 w-[min(24rem,calc(100vw-1rem))] min-w-0 top-auto left-auto gap-0"
                  >
                    <For each={merge.allowed()}>
                      {(value) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={value === dialog().method}
                          class="flex w-full items-start gap-2 p-2 text-left hover:bg-accent focus-visible:bg-accent"
                          onClick={() => editor.actions.chooseMergeMethod(value)}
                        >
                          <span class="size-4 shrink-0">
                            <Show when={value === dialog().method}>
                              <span class="icon-[ph--check]" aria-hidden="true" />
                            </Show>
                          </span>
                          <span class="min-w-0 space-y-1">
                            <span class="block whitespace-nowrap text-sm font-medium">
                              {mergeMethodInfo(value).label}
                            </span>
                            <span class="block whitespace-normal text-xs text-muted-foreground">
                              {mergeMethodInfo(value).explain(merge.commitCount(), merge.base())}
                            </span>
                          </span>
                        </button>
                      )}
                    </For>
                  </DropdownMenu>
                </Show>
              </div>
            </div>
          </footer>
        </div>
      </Dialog>
    </Show>
  );
}
function CommitFields(props: CommitFieldsProps): JSX.Element {
  const editor = useEditor();
  const dialog = () => editor.merge.state.dialog;
  let instructions: HTMLInputElement | undefined;
  createEffect(() => {
    if (dialog().aiOpen) queueMicrotask(() => instructions?.focus());
  });
  const rewriting = () => dialog().rewriting;
  const isDefault = () => {
    const original = editor.merge.state.info?.defaults?.[dialog().method] || {
      title: '',
      message: '',
    };
    return props.draft.title === original.title && props.draft.message === original.message;
  };
  return (
    <div id="pr-merge-commit" data-ui="pr-merge-commit" class="field flex flex-col gap-3">
      {/* aislop-ignore-next-line jsx-a11y/label-has-associated-control -- Solid associates this label through for. */}
      <label data-ui="pr-merge-label" class="label text-foreground" for="pr-merge-commit-title">
        Commit title
      </label>
      <input
        id="pr-merge-commit-title"
        type="text"
        spellcheck={false}
        autocomplete="off"
        class="input h-8!"
        data-control="pr-merge-input"
        autofocus
        value={props.draft.title}
        onInput={(event) => editor.actions.setMergeField('title', event.currentTarget.value)}
      />
      <div data-ui="pr-merge-label-row" class="flex items-baseline justify-between">
        {/* aislop-ignore-next-line jsx-a11y/label-has-associated-control -- Solid associates this label through for. */}
        <label data-ui="pr-merge-label" class="label text-foreground" for="pr-merge-commit-body">
          Commit message
        </label>
        <div class="flex items-center gap-2">
          <button
            type="button"
            id="pr-merge-ai-toggle"
            title="Rewrite the commit message"
            aria-label="Rewrite the commit message"
            class="btn"
            data-variant="special"
            data-size="xs"
            aria-expanded={dialog().aiOpen}
            aria-controls="pr-merge-ai-row"
            disabled={rewriting().pending}
            onClick={() => editor.actions.setMergeAIOpen(!dialog().aiOpen)}
          >
            <span class="icon-[ph--spinner]" aria-hidden="true" />
            Rewrite
          </button>
          <button
            type="button"
            id="pr-merge-reset"
            title="Reset to default message"
            aria-label="Reset to default message"
            disabled={isDefault() || rewriting().pending}
            data-ui="pr-merge-link"
            class="btn"
            data-variant="ghost"
            data-size="icon-xs"
            onClick={editor.actions.resetMergeMessage}
          >
            <span class="icon-[ph--arrow-counter-clockwise]" aria-hidden="true" />
          </button>
        </div>
      </div>
      <textarea
        id="pr-merge-commit-body"
        rows="8"
        spellcheck={false}
        autocomplete="off"
        class="textarea min-h-28 max-h-[30vh] resize-y overflow-y-auto"
        data-control="pr-merge-input pr-merge-body"
        value={props.draft.message}
        onInput={(event) => editor.actions.setMergeField('message', event.currentTarget.value)}
      />
      <Show when={dialog().aiOpen}>
        <div id="pr-merge-ai-row" data-ui="pr-merge-ai" class="flex items-center gap-2">
          <input
            ref={instructions}
            aria-label="Rewrite instructions"
            type="text"
            spellcheck={false}
            autocomplete="off"
            id="pr-merge-ai-instruction"
            placeholder="Instructions for this rewrite (optional), e.g. Conventional Commits, mention the ticket"
            class="input h-8!"
            data-control="pr-merge-input"
            value={dialog().instruction}
            onInput={(event) => editor.actions.setMergeInstruction(event.currentTarget.value)}
          />
          <div class="git-agent-picker flex flex-col gap-2">
            <AgentPicker id="pr-merge-agent" />
          </div>
          <button
            id="pr-merge-ai"
            type="button"
            title="Have the harness rewrite the title and message from the PR's commits and diff"
            class="btn"
            data-variant="special"
            data-size="xs"
            disabled={rewriting().pending}
            onClick={() => void editor.actions.rewriteMergeMessage()}
          >
            <span
              class="icon-[ph--spinner] shrink-0"
              classList={{ 'motion-safe:animate-spin': rewriting().pending }}
              aria-hidden="true"
            />
            {rewriting().pending ? `Rewriting... (${rewriting().seconds}s)` : 'Rewrite'}
          </button>
        </div>
      </Show>
      <Show when={editor.merge.state.info?.hasInstruction}>
        <span class="text-xs text-muted-foreground">
          Your{' '}
          <button
            type="button"
            class="text-primary-text underline"
            onClick={() => {
              editor.actions.closeMergeDialog();
              editor.actions.openSettings('ui', 'Git & Diff', 'git.commitMessageInstruction');
            }}
          >
            commit message instructions
          </button>{' '}
          from Settings apply too.
        </span>
      </Show>
    </div>
  );
}
function CommitList(): JSX.Element {
  const editor = useEditor();
  const commits = () => (editor.merge.state.info?.commits || []).slice().reverse();
  return (
    <ol id="pr-merge-commit-list" data-ui="pr-merge-commit-list" class="overflow-y-auto p-3">
      <For each={commits()} fallback={<li class="empty text-muted-foreground">No commits</li>}>
        {(commit) => (
          <li>
            <code>{commit.short}</code> {commit.subject}
          </li>
        )}
      </For>
    </ol>
  );
}
