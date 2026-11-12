import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Dialog } from '../lib/Dialog.jsx';
export function NewItemDialog() {
  const editor = useEditor();
  return (
    <Show when={editor.tree.state.newItem}>
      {(item) => (
        <Dialog
          open={true}
          title={item().type === 'dir' ? 'New Folder' : 'New File'}
          onClose={editor.actions.closeNewItem}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void editor.actions.createItem();
            }}
          >
            <label class="field">
              Path from project root
              <input
                id="modal-input"
                class="input"
                aria-label="New item path"
                autofocus
                autocomplete="off"
                value={item().path}
                onFocus={(event) =>
                  event.currentTarget.setSelectionRange(item().path.length, item().path.length)
                }
                onInput={(event) => editor.actions.setNewItemPath(event.currentTarget.value)}
              />
            </label>
            <Show when={item().error}>
              <p role="alert" class="text-destructive">
                {item().error}
              </p>
            </Show>
            <footer class="flex justify-end gap-2">
              <button type="button" class="btn" onClick={editor.actions.closeNewItem}>
                Cancel
              </button>
              <button id="modal-btn-ok" class="btn" type="submit" disabled={item().pending}>
                {item().pending ? 'Creating…' : 'Create'}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
    </Show>
  );
}
