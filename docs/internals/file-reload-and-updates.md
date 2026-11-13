# File Updates & In-Place Tab Reloading

How open tabs follow changes on disk: re-indexing, Git operations, agent edits, saves and edits made outside faah. The code is `reloadOpenTabs` in [`web/src/editor/edit-actions.js`](../../web/src/editor/edit-actions.js), the per-document buffer in [`web/src/editor/buffer.js`](../../web/src/editor/buffer.js), the Git-driven plan in [`web/src/git/documents.js`](../../web/src/git/documents.js), and the server's [`internal/render/render.go`](../../internal/render/render.go).

---

## 1. When tabs reload

Most file changes happen outside faah: `git checkout`, `git pull`, branch switches, generated code, another editor. Open tabs must show the new text without closing, switching tabs, losing the caret or adding history entries.

| Trigger | Call |
|---|---|
| Re-index (sidebar button, `Mod+Shift+R`, palette) | `reindexWorkspace` → `reloadOpenTabs()` |
| A rewritten history (reset, rebase, checkout) | `historyChanged` → re-index and `reloadOpenTabs()` |
| An agent job that changed files | `reloadOpenTabs()` from `agents/store.ts` |
| Leaving edit mode | `exitEditMode` → `reloadOpenTabs()` |
| A Git snapshot on the event stream | `reloadOpenTabs({ onlyIfChanged: true })` from `git/documents.ts` |

## 2. How a reload works

`reloadOpenTabs` runs every eligible tab concurrently with `Promise.allSettled`, so one failed file (deleted, unreadable) leaves its tab as it was and does not stop the others. It skips:

- commit-pinned tabs (`diffRef`), whose text cannot change;
- dirty and editing tabs, so unsaved work is never replaced;
- image tabs, which have no text buffer.

For each remaining tab it reloads only the 1,000-line window around the caret. A full reload resets the buffer first; other windows load again as they scroll into view. The caret is clamped to the new line count, the outline is dropped, and the gutter reloads. The tab stays where it is in the tab list, and its view (source, preview or diff) and scroll position stay on the document entry, so nothing switches or resets.

`onlyIfChanged` is the cheap mode used on every Git snapshot. The buffer fetches the caret window and compares it with what it has. When the lines and total match, it publishes only metadata and keeps every cached window. When they differ, it invalidates the other windows only after the changed response is ready, so the view never shows an empty window in between.

Every loaded window is guarded: a request belongs to one buffer generation and is aborted when the buffer resets or the tab closes, so a late reply cannot write into a replaced or closed document.

## 3. Server cache coherence

On the Go server, `/api/file` calls `Open(abs, rel)` in [`internal/render/render.go`](../../internal/render/render.go):

```go
key := fmt.Sprintf("%s|%d|%d", abs, st.ModTime().UnixNano(), st.Size())
if d := cache.get(key); d != nil {
    return d, nil
}
```

- **Compound Key Invalidation**: The server cache key includes the file's absolute path, nanosecond modification timestamp (`ModTime().UnixNano()`), and byte size.
- **Zero-Cost Unchanged Reads**: If a file was untouched during workspace re-indexing, its key matches the LRU cache. The server serves the cached `Doc` without re-reading the filesystem or re-running Chroma tokenization.
- **Automatic Invalidation**: If the file was modified, the timestamp/size changes, triggering a cache miss, fresh disk read (`os.ReadFile`), and Lexer pass.

## 4. Git changes and the diff view

`git/documents.ts` compares each snapshot with the last one. An identical snapshot only runs the `onlyIfChanged` reload. Otherwise `documentGitPlan` (in `git/document-logic.ts`, unit tested) decides which diff tabs close because their changes disappeared, which tabs gain or lose `diffAvailable`, and whether to reload. PR tabs, commit-pinned tabs and unsaved edits survive working-tree changes. A tab in source view stays in source when new changes appear; a tab opened in the diff view returns to it when changes come back, unless the reader dismissed the diff.

---

## 6. Related Documentation

- [System Architecture & Runtime Lifecycle](architecture.md) — HTTP router, lifecycle, and proactive memory management.
- [Editor Virtualization & Caret Engine](editor-virtualization.md) — Viewport virtualization, DOM recycling, and selection preservation.
- [Git Awareness & Diffing](git-integration.md) — CLI shell-out git status generation and diff view synchronization.
- [Windowed Syntax Highlighting](syntax-highlighting.md) — Dual-tier Chroma tokenization and chunked line streaming.
