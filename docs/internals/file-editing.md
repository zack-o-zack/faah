# Direct File Editing & Creation

Implementation notes for in-browser editing. User-facing behavior is in [Direct File Editing](../features/file-editing.md).

## 1. Endpoints

Both are `POST` with a JSON body and are resolved through `safePath`, so paths outside the workspace are rejected.

| Endpoint | Body | Behavior |
| :--- | :--- | :--- |
| `/api/file/save` | `{path, content}` | Creates missing parent directories, refuses a directory target, writes the file (`0644`). Then `Evict` drops the highlight cache entry, the LSP document is closed and open documents refreshed, the git watcher is triggered, and the index rebuilds in the background. Returns `{ok, path, size}`. |
| `/api/fs/new` | `{path, type}` | `type` is `file` or `dir`. Returns `409` if the path exists. Creates parents, writes an empty file or the directory, triggers the git watcher, rebuilds the index. Returns `{ok, path, type}`. |

Handlers are `handleFileSave` and `handleFSNew` in [`server.go`](../../server.go); tests are in [`px0_test.go`](../../px0_test.go) (save, creation, conflict, traversal).

## 2. Frontend

[`web/src/editor/edit-actions.js`](../../web/src/editor/edit-actions.js) owns the edit transitions; [`web/src/editor/EditView.tsx`](../../web/src/editor/EditView.tsx) owns the surface: a `<textarea id="editview-textarea">` and a gutter inside `#editview`, over the virtualized viewport. The source rows render an empty window while a document is editing.

- **State.** The document entry holds `isEditing` and `dirty`; the document's buffer holds the working text (`editContent`). Switching tabs therefore needs no copying: `EditView` shows the active buffer's text and restores its scroll when the edited document changes.
- **Entering.** `enterEditMode(line)` refuses images, deleted files and commit-pinned tabs, asks before loading a file over 10,000 lines or 1 MB, loads `/api/raw` once with a cancellable request (`editLoading`/`editError` in the UI state), clears `diffMode`, and centres the given line, or the caret line.
- **Gutter.** Line numbers are virtualized: only the visible numbers are created, with wrapped lines measured, instead of one element per line.
- **Keys.** Tab, Enter auto-indent, `Mod+S` and `Esc` are handled on the textarea; edits go through `document.execCommand('insertText')` so the browser's undo stack is kept.
- **Previews.** A document that is editing always shows the source view (`viewMode` in `viewers/view.ts`), so the Markdown or table preview and the diff view are hidden without changing the chosen view.
- **Leaving.** `exitEditMode()` asks before discarding unsaved changes, drops the working text and reloads open tabs, so the source and preview are fetched again.
- **After save.** `saveActiveFile()` posts the text, clears `dirty` when the text has not changed since, and refreshes the workspace so the Git panel does not wait for the next stream event. Creating an item in `NewItemDialog` refreshes the same way.

`Mod+E` and `Mod+S` are bound in [`EditorShortcuts.tsx`](../../web/src/editor/EditorShortcuts.tsx); the palette commands are in [`palette/features.ts`](../../web/src/palette/features.js). Closing a dirty tab asks first (`closeTabs` in `editor/store.ts`), and the app's `beforeunload` listener (`app/App.tsx`) warns while any tab is dirty.
