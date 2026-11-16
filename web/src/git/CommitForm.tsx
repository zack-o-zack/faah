import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { AgentChoice } from './AgentChoice.tsx';
export function CommitForm(): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={editor.git.counts().hasChanges}>
      <div id="git-commit-section" class="git-commit-section flex flex-col gap-2">
        <div class="input-group" data-orientation="vertical">
          <textarea
            id="git-commit-msg"
            class="max-h-40 min-h-9 text-sm"
            data-control="git-commit-msg"
            aria-label="Commit message"
            placeholder="Message (optional)"
            rows="1"
            spellcheck={false}
            autocomplete="off"
            value={editor.git.state.message}
            onInput={(event) => editor.actions.setCommitMessage(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void editor.actions.commit();
              }
            }}
          />
          <footer data-align="block-end" class="gap-1">
            <AgentChoice />
            <button
              id="git-instructions-link"
              class="btn"
              type="button"
              title="Message instructions"
              aria-label="Message instructions"
              data-variant="ghost"
              data-size="icon-xs"
              onClick={() =>
                editor.actions.openSettings('ui', 'Git & Diff', 'git.commitMessageInstruction')
              }
            >
              <span class="icon-[ph--sliders-horizontal] size-3.5 shrink-0" aria-hidden="true" />
            </button>
            <button
              id="git-generate-msg"
              type="button"
              title="Write a message for these changes"
              aria-label="Write a message for these changes"
              class="btn"
              data-variant="special"
              data-size="icon-xs"
              disabled={!!editor.git.state.pending}
              onClick={() => void editor.actions.generateCommitMessage()}
            >
              <span
                data-ui="icon"
                class="icon-[ph--sparkle] size-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </footer>
        </div>
      </div>
    </Show>
  );
}
