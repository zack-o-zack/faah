import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { keyLabel } from '../lib/keyboard.ts';
import { AgentPicker } from '../agents/AgentPicker.tsx';
import { MERGE_METHODS } from './logic.ts';
// Shows exactly what lands on the base: method, commit title and message, and what blocks it.
export function MergeDialog() {
  const editor = useEditor();
  const merge = editor.merge;
  const dialog = () => merge.state.dialog;
  const method = () => MERGE_METHODS[dialog().method];
  const draft = () => dialog().drafts[dialog().method] || { title: '', message: '' };
  const blocked = () => merge.warnings()?.block || '';
  return (
    <Show when={dialog().open}>
      <Dialog
        open={true}
        title={`Merge pull request #${editor.pr.meta()?.number}`}
        subtitle={`${editor.pr.meta()?.head} → ${merge.base()}`}
        class="max-w-xl"
        onClose={editor.actions.closeMergeDialog}
        footer={
          <>
            <span class="flex-1 text-xs text-muted-foreground">
              {keyLabel('Mod+Enter')} to merge, Esc to cancel
            </span>
            <button
              type="button"
              class="btn"
              data-variant="ghost"
              data-size="xs"
              onClick={editor.actions.closeMergeDialog}
            >
              Cancel
            </button>
            <button
              id="pr-merge-confirm"
              type="button"
              class="btn"
              data-variant="primary"
              data-size="xs"
              title={blocked()}
              disabled={!!blocked() || dialog().pending || dialog().rewriting.pending}
              onClick={() => void editor.actions.confirmMerge()}
            >
              {dialog().pending ? 'Merging...' : method().confirm}
            </button>
          </>
        }
      >
        <div
          class="flex flex-col gap-3 overflow-auto"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            void editor.actions.confirmMerge();
          }}
        >
          <div class="button-group inline-flex!" role="radiogroup" aria-label="Merge method">
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
                  {MERGE_METHODS[value].label}
                </button>
              )}
            </For>
          </div>
          <p class="text-muted-foreground">{method().explain(merge.commitCount(), merge.base())}</p>
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
        </div>
      </Dialog>
    </Show>
  );
}
function CommitFields(props) {
  const editor = useEditor();
  const dialog = () => editor.merge.state.dialog;
  const hasHarness = () =>
    editor.agents.state.harnesses.some((harness) => harness.installed) ||
    !!editor.agents.state.selected;
  const squash = () => dialog().method === 'squash';
  const rewriteShown = () => hasHarness() && (!squash() || dialog().rewrite);
  const rewriting = () => dialog().rewriting;
  return (
    <div class="field flex flex-col gap-2">
      <Show when={squash() && hasHarness()}>
        <label class="label inline-flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
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
      </Show>
      <label class="label text-muted-foreground" for="pr-merge-commit-title">
        Commit title
      </label>
      <input
        id="pr-merge-commit-title"
        type="text"
        spellcheck={false}
        autocomplete="off"
        class="input h-8!"
        autofocus
        value={props.draft.title}
        onInput={(event) => editor.actions.setMergeField('title', event.currentTarget.value)}
      />
      <div class="flex items-baseline justify-between">
        <label class="label text-muted-foreground" for="pr-merge-commit-body">
          Commit message
        </label>
        <button
          type="button"
          class="btn text-primary-text"
          data-variant="link"
          data-size="xs"
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
        value={props.draft.message}
        onInput={(event) => editor.actions.setMergeField('message', event.currentTarget.value)}
      />
      <Show when={rewriteShown()}>
        <div class="flex flex-wrap items-center gap-2">
          <input
            aria-label="Rewrite instructions"
            type="text"
            spellcheck={false}
            autocomplete="off"
            placeholder="Instructions for this rewrite (optional), e.g. Conventional Commits"
            class="input h-8! min-w-0 flex-1"
            value={dialog().instruction}
            onInput={(event) => editor.actions.setMergeInstruction(event.currentTarget.value)}
          />
          <AgentPicker />
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
function CommitList() {
  const editor = useEditor();
  const commits = () => (editor.merge.state.info?.commits || []).slice().reverse();
  return (
    <ol class="flex max-h-60 flex-col gap-1 overflow-y-auto p-3 text-sm">
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
