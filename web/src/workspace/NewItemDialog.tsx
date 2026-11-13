import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Dialog } from '../lib/Dialog.tsx';
export function NewItemDialog(): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={editor.tree.state.newItem}>
      {(item) => {
        const prefix = item().path;
        return (
          <Dialog
            open
            bare
            id="input-modal"
            title={item().type === 'dir' ? 'New Folder' : 'New File'}
            onClose={editor.actions.closeNewItem}
          >
            <div>
              <header class="flex-row! items-center justify-between">
                <h2 id="modal-title" class="text-14 font-semibold">
                  {item().type === 'dir' ? 'New Folder' : 'New File'}
                </h2>
                <button
                  id="modal-btn-close"
                  type="button"
                  title="Close (Esc)"
                  aria-label="Close (Esc)"
                  class="btn"
                  data-control="icon-action"
                  data-variant="ghost"
                  data-size="icon-xs"
                  onClick={editor.actions.closeNewItem}
                >
                  <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
                </button>
              </header>
              <section class="flex flex-col gap-2">
                <div id="modal-desc" data-ui="fs-modal-desc" class="text-muted-foreground">
                  {prefix
                    ? `Create inside ${prefix} (or specify path):`
                    : 'Enter relative path from project root:'}
                </div>
                <input
                  id="modal-input"
                  class="input h-8!"
                  data-control="fs-modal-input"
                  aria-label="New item path"
                  autofocus
                  autocomplete="off"
                  spellcheck={false}
                  value={item().path}
                  onFocus={(event) =>
                    event.currentTarget.setSelectionRange(item().path.length, item().path.length)
                  }
                  onInput={(event) => editor.actions.setNewItemPath(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void editor.actions.createItem();
                    }
                  }}
                />
                <Show when={item().error}>
                  <p role="alert" class="text-destructive">
                    {item().error}
                  </p>
                </Show>
              </section>
              <footer class="flex-row! justify-end gap-2">
                <button
                  id="modal-btn-cancel"
                  type="button"
                  class="btn"
                  data-control="bar-action"
                  data-variant="ghost"
                  data-size="xs"
                  onClick={editor.actions.closeNewItem}
                >
                  Cancel
                </button>
                <button
                  id="modal-btn-ok"
                  type="button"
                  class="btn"
                  data-control="bar-action"
                  data-variant="primary"
                  data-size="xs"
                  disabled={item().pending}
                  onClick={() => void editor.actions.createItem()}
                >
                  {item().pending ? 'Creating…' : 'Create'}
                </button>
              </footer>
            </div>
          </Dialog>
        );
      }}
    </Show>
  );
}
