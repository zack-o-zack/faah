import { onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Dialog } from '../lib/Dialog.tsx';
export function StageEditor() {
  const editor = useEditor();
  const edit = () => editor.review.state.edit;
  const field = (key) => (event) => editor.actions.setStageField(key, event.currentTarget.value);
  return (
    <Show when={edit().index < 0} fallback={<InlineStageEditor />}>
      <Dialog
        open
        bare
        id="review-add-stage-modal"
        title="Add Review Stage"
        onClose={editor.actions.cancelStageEditor}
      >
        <div class="overflow-auto">
          <header class="flex-row! items-center justify-between shrink-0">
            <h2 id="add-stage-title">Add Review Stage</h2>
            <div class="flex items-center gap-3">
              <button
                id="add-stage-close"
                type="button"
                title="Close (Esc)"
                aria-label="Close (Esc)"
                class="btn"
                data-control="mini settings-close-btn"
                data-variant="ghost"
                data-size="icon-xs"
                onClick={editor.actions.cancelStageEditor}
              >
                <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </header>
          <section data-ui="review-config-body" class="flex flex-col overflow-y-auto gap-2 p-3">
            <label data-ui="review-config-field" class="field flex flex-col gap-2">
              <span class="label">Stage Title</span>
              <input
                type="text"
                id="add-stage-title-input"
                placeholder="e.g. Security & Permissions"
                class="input h-8!"
                autofocus
                value={edit().value.title}
                onInput={field('title')}
              />
            </label>
            <label data-ui="review-config-field" class="field flex flex-col gap-2">
              <span class="label">Review Question</span>
              <input
                type="text"
                id="add-stage-q-input"
                placeholder="e.g. Does this PR introduce any auth or injection risks?"
                class="input h-8!"
                value={edit().value.question}
                onInput={field('question')}
              />
            </label>
            <label data-ui="review-config-field" class="field flex flex-col gap-2">
              <span class="label">Detailed AI Prompt</span>
              <textarea
                rows="3"
                id="add-stage-prompt-input"
                placeholder="What the harness should look at and how to answer"
                class="textarea resize-y"
                value={edit().value.prompt}
                onInput={field('prompt')}
              />
            </label>
          </section>
          <footer>
            <button
              id="add-stage-cancel"
              type="button"
              class="btn"
              data-control="bar-action"
              data-variant="ghost"
              data-size="xs"
              onClick={editor.actions.cancelStageEditor}
            >
              Cancel
            </button>
            <button
              id="add-stage-submit"
              type="button"
              class="btn"
              data-control="bar-action pr-btn-merge"
              data-variant="primary"
              data-size="xs"
              disabled={editor.review.state.pending === 'config'}
              onClick={() => void editor.actions.saveStage()}
            >
              Add Stage
            </button>
          </footer>
        </div>
      </Dialog>
    </Show>
  );
}
function InlineStageEditor() {
  const editor = useEditor();
  const edit = () => editor.review.state.edit;
  const field = (key) => (event) => editor.actions.setStageField(key, event.currentTarget.value);
  let question;
  onMount(() => question.focus());
  return (
    <form
      id="review-stage-inline-editor"
      data-ui="review-stage-inline-editor"
      class="flex flex-col gap-3 border-b px-4 py-3"
      aria-label="Edit stage"
      onSubmit={(event) => {
        event.preventDefault();
        void editor.actions.saveStage();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          editor.actions.cancelStageEditor();
        }
      }}
    >
      <label class="field flex flex-col gap-2">
        <span class="label">Stage Title</span>
        <input
          type="text"
          id="inline-edit-stage-title"
          aria-label="Stage title"
          placeholder="e.g. Performance Impact"
          class="input h-8!"
          data-control="review-inline-input"
          value={edit().value.title}
          onInput={field('title')}
        />
      </label>
      <label class="field flex flex-col gap-2">
        <span class="label">Review Question</span>
        <textarea
          ref={question}
          id="inline-edit-stage-q"
          aria-label="Stage question"
          rows="2"
          placeholder="e.g. Are there any performance bottlenecks or lock contentions?"
          class="textarea resize-y"
          data-control="review-inline-textarea"
          value={edit().value.question}
          onInput={field('question')}
        />
      </label>
      <label class="field flex flex-col gap-2">
        <span class="label">Instructions for the harness</span>
        <textarea
          id="inline-edit-stage-prompt"
          aria-label="Stage instructions"
          rows="3"
          placeholder="What the harness should look at and how to answer"
          class="textarea resize-y"
          data-control="review-inline-textarea"
          value={edit().value.prompt}
          onInput={field('prompt')}
        />
      </label>
      <div class="flex gap-2">
        <button
          id="btn-save-stage-inline"
          type="submit"
          class="btn"
          data-control="bar-action"
          data-variant="primary"
          data-size="xs"
          disabled={editor.review.state.pending === 'config'}
        >
          Save Changes
        </button>
        <button
          id="btn-cancel-stage-inline"
          type="button"
          class="btn"
          data-control="bar-action"
          data-variant="ghost"
          data-size="xs"
          onClick={editor.actions.cancelStageEditor}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
