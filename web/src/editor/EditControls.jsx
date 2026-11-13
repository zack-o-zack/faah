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
        data-variant="ghost"
        data-size="icon-xs"
      >
        <span class="icon-[lucide--square-pen] size-3.5" />
      </button>
      <button
        id="btn-cancel-edit"
        class="btn"
        hidden={!editor.active()?.isEditing}
        onClick={() => void editor.actions.exitEditMode()}
        data-variant="outline"
        data-size="xs"
        data-control="edit-btn-done"
      >
        Done
      </button>
      <button
        id="btn-save-file"
        class="btn"
        hidden={!editor.active()?.isEditing}
        onClick={() => void editor.actions.saveActiveFile()}
        data-variant="primary"
        data-size="xs"
        data-control="edit-btn-save"
      >
        Save
      </button>
    </div>
  );
}
