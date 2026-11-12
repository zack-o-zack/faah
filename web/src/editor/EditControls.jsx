import { useEditor } from './context.jsx';
export function EditControls() {
  const editor = useEditor();
  const unavailable = () =>
    !editor.active() ||
    editor.active().isImage ||
    editor.active().deleted ||
    editor.active().diffRef;
  return (
    <div
      id="edit-switch"
      class="flex items-center gap-1"
      role="group"
      aria-label="Edit controls"
      hidden={unavailable()}
    >
      <button
        id="btn-edit-mode"
        class="btn"
        aria-label="Edit this file"
        disabled={editor.ui.editLoading}
        aria-busy={editor.ui.editLoading}
        hidden={editor.active()?.isEditing}
        onClick={() => void editor.actions.enterEditMode()}
      >
        <span class="icon-[lucide--square-pen] size-3.5" />
      </button>
      <button
        id="btn-cancel-edit"
        class="btn"
        hidden={!editor.active()?.isEditing}
        onClick={() => void editor.actions.exitEditMode()}
      >
        Done
      </button>
      <button
        id="btn-save-file"
        class="btn"
        hidden={!editor.active()?.isEditing}
        onClick={() => void editor.actions.saveActiveFile()}
      >
        Save
      </button>
    </div>
  );
}
