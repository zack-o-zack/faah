import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { AgentChoice } from './AgentChoice.jsx';
export function CommitForm() {
  const editor = useEditor();
  return (
    <Show when={editor.git.counts().hasChanges}>
      <form
        class="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void editor.actions.commit();
        }}
      >
        <textarea
          id="git-commit-msg"
          class="textarea"
          aria-label="Commit message"
          placeholder="Message (optional)"
          rows="2"
          value={editor.git.state.message}
          onInput={(event) => editor.actions.setCommitMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void editor.actions.commit();
            }
          }}
        />
        <AgentChoice />
        <div class="flex gap-1">
          <button
            id="git-instructions-link"
            class="btn"
            type="button"
            onClick={() =>
              editor.actions.openSettings('ui', 'Git & Diff', 'git.commitMessageInstruction')
            }
          >
            Message instructions
          </button>
          <button
            id="git-generate-msg"
            type="button"
            class="btn"
            disabled={!!editor.git.state.pending}
            onClick={() => void editor.actions.generateCommitMessage()}
          >
            Write message
          </button>
        </div>
        <button
          id="git-commit"
          type="submit"
          class="btn"
          data-variant="primary"
          disabled={!!editor.git.state.pending}
        >
          {editor.git.state.pending || 'Commit'}
        </button>
      </form>
    </Show>
  );
}
