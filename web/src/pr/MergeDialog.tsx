import type { MergeMessage } from './types.ts';

interface CommitFieldsProps {
  draft: MergeMessage;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ReviewDialogHeader } from './ReviewDialogHeader.tsx';
import { ReviewDialogFooter } from './ReviewDialogFooter.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
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
        <div class="overflow-auto">
          <ReviewDialogHeader
            prefix="pr-merge"
            title={`Merge pull request #${editor.pr.meta()?.number}`}
            onClose={editor.actions.closeMergeDialog}
          >
            <code>{editor.pr.meta()?.head}</code>{' '}
            <span class="icon-[lucide--arrow-right] size-3 align-[-2px]" aria-hidden="true" />{' '}
            <code>{merge.base()}</code>
          </ReviewDialogHeader>
          <section class="flex flex-col gap-3 overflow-auto">
            <div
              id="pr-merge-methods"
              class="button-group"
              role="radiogroup"
              aria-label="Merge method"
            >
              <For each={merge.allowed()}>
                {(value) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={value === dialog().method}
                    aria-pressed={value === dialog().method}
                    class="btn"
                    data-variant={value === dialog().method ? 'secondary' : 'ghost'}
                    data-size="xs"
                    onClick={() => editor.actions.setMergeMethod(value)}
                  >
                    {mergeMethodInfo(value).label}
                  </button>
                )}
              </For>
            </div>
            <p id="pr-merge-explain" data-ui="pr-merge-explain" class="text-muted-foreground">
              {method().explain(merge.commitCount(), merge.base())}
            </p>
            <Show when={blocked()}>
              <div class="alert p-3" data-variant="destructive">
                {blocked()}
              </div>
            </Show>
            <For each={merge.warnings()?.notes || []}>
              {(note) => <div class="alert p-3">{note}</div>}
            </For>
            <Show when={dialog().method !== 'rebase'} fallback={<CommitList />}>
              <CommitFields draft={draft()} />
            </Show>
            <ErrorNotice error={dialog().error} />
          </section>
          <ReviewDialogFooter
            prefix="pr-merge"
            hint={`${keyLabel('Mod+Enter')} to merge, Esc to cancel`}
            confirm={dialog().pending ? 'Merging...' : method().confirm}
            disabled={!!blocked() || dialog().pending || dialog().rewriting.pending}
            onClose={editor.actions.closeMergeDialog}
            onConfirm={editor.actions.confirmMerge}
          />
        </div>
      </Dialog>
    </Show>
  );
}
function CommitFields(props: CommitFieldsProps): JSX.Element {
  const editor = useEditor();
  const dialog = () => editor.merge.state.dialog;
  const hasHarness = () =>
    editor.agents.state.harnesses.some((harness) => harness.installed) ||
    !!editor.agents.state.selected;
  const squash = () => dialog().method === 'squash';
  const rewriteShown = () => hasHarness() && (!squash() || dialog().rewrite);
  const rewriting = () => dialog().rewriting;
  return (
    <div id="pr-merge-commit" data-ui="pr-merge-commit" class="field flex flex-col gap-2">
      <Show when={squash() && hasHarness()}>
        <div
          id="pr-merge-ai-checkbox-wrap"
          data-ui="pr-merge-ai-checkbox-wrap"
          class="flex items-center gap-2"
        >
          <label
            for="pr-merge-ai-checkbox"
            data-ui="pr-merge-checkbox-label"
            class="label label inline-flex items-center cursor-pointer select-none gap-2"
          >
            <input
              type="checkbox"
              id="pr-merge-ai-checkbox"
              class="input"
              checked={dialog().rewrite}
              onChange={(event) => editor.actions.setMergeRewrite(event.currentTarget.checked)}
            />
            <span>
              {rewriting().pending
                ? `Rewriting... (${rewriting().seconds}s)`
                : 'Rewrite commit message with AI'}
            </span>
          </label>
        </div>
      </Show>
      {/* aislop-ignore-next-line jsx-a11y/label-has-associated-control -- Solid associates this label through for. */}
      <label
        data-ui="pr-merge-label"
        class="label label text-muted-foreground"
        for="pr-merge-commit-title"
      >
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
        <label
          data-ui="pr-merge-label"
          class="label label text-muted-foreground"
          for="pr-merge-commit-body"
        >
          Commit message
        </label>
        <button
          type="button"
          id="pr-merge-reset"
          data-ui="pr-merge-link"
          class="text-primary-text"
          onClick={editor.actions.resetMergeMessage}
        >
          Reset to default
        </button>
      </div>
      <textarea
        id="pr-merge-commit-body"
        rows="8"
        spellcheck={false}
        autocomplete="off"
        class="textarea resize-y"
        data-control="pr-merge-input pr-merge-body"
        value={props.draft.message}
        onInput={(event) => editor.actions.setMergeField('message', event.currentTarget.value)}
      />
      <Show when={rewriteShown()}>
        <div id="pr-merge-ai-row" data-ui="pr-merge-ai" class="flex items-center gap-2">
          <input
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
              class={`${rewriting().pending ? 'icon-[lucide--loader-circle] animate-spin' : 'icon-[lucide--sparkle]'} size-3.5 shrink-0`}
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
          from Settings apply to rewrites.
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
