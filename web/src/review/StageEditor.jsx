import { useEditor } from '../editor/context.jsx';
// Edits the selected stage in place, or a new stage appended to the pipeline.
export function StageEditor() {
  const editor = useEditor();
  const edit = () => editor.review.state.edit;
  const field = (key) => (event) => editor.actions.setStageField(key, event.currentTarget.value);
  return (
    <form
      id="review-stage-inline-editor"
      class="flex flex-col gap-3 border-b px-4 py-3"
      aria-label={edit().index < 0 ? 'New stage' : 'Edit stage'}
      onSubmit={(event) => {
        event.preventDefault();
        void editor.actions.saveStage();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        editor.actions.cancelStageEditor();
      }}
    >
      <label class="field flex flex-col gap-2">
        <span class="label">Stage title</span>
        <input
          type="text"
          id="inline-edit-stage-title"
          placeholder="e.g. Performance Impact"
          class="input h-8!"
          autofocus
          value={edit().value.title}
          onInput={field('title')}
        />
      </label>
      <label class="field flex flex-col gap-2">
        <span class="label">Review question</span>
        <textarea
          id="inline-edit-stage-q"
          rows="2"
          placeholder="e.g. Are there any performance bottlenecks or lock contentions?"
          class="textarea resize-y"
          value={edit().value.question}
          onInput={field('question')}
        />
      </label>
      <label class="field flex flex-col gap-2">
        <span class="label">Instructions for the harness</span>
        <textarea
          id="inline-edit-stage-prompt"
          rows="3"
          placeholder="What the harness should look at and how to answer"
          class="textarea resize-y"
          value={edit().value.prompt}
          onInput={field('prompt')}
        />
      </label>
      <div class="flex gap-2">
        <button
          id="btn-save-stage-inline"
          type="submit"
          class="btn"
          data-variant="primary"
          data-size="xs"
          disabled={editor.review.state.pending === 'config'}
        >
          {edit().index < 0 ? 'Add stage' : 'Save changes'}
        </button>
        <button
          id="btn-cancel-stage-inline"
          type="button"
          class="btn"
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
