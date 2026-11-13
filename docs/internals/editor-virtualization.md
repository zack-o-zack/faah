# Editor Virtualization & Caret Engine

How faah's virtualized code view, caret and selection work. The code is [`web/src/editor/Viewport.jsx`](../../web/src/editor/Viewport.jsx), [`EditorRow.jsx`](../../web/src/editor/EditorRow.jsx), [`Caret.jsx`](../../web/src/editor/Caret.jsx), the buffer in [`buffer.js`](../../web/src/editor/buffer.js), and the pure geometry in [`layout.js`](../../web/src/editor/layout.js) and [`cursor.js`](../../web/src/editor/cursor.js). [Frontend implementation](frontend.md) describes how these fit into the app.

The sidebar file tree is virtualized separately: [`workspace/tree-model.ts`](../../web/src/workspace/tree-model.js) flattens the expanded tree and [`Tree.jsx`](../../web/src/workspace/Tree.jsx) renders a bounded window of it. Its Expand All loads directory children in small batches, skips ignored subtrees and can be cancelled without late replies reopening collapsed folders.

## 1. Why a Bespoke Virtualized Viewer?

General-purpose browser code editors (such as Monaco, CodeMirror 6, or Ace) are engineered for bidirectional text editing, undo/redo trees, multi-cursor keystrokes, and complex grammar parsing inside the browser. Consequently:

- They bundle massive JavaScript runtimes (several megabytes).
- Their initialization latency takes hundreds of milliseconds.
- Complex DOM representations degrade frame rates when scrolling large files.

Because faah is a code inspection and navigation tool that does not edit text in the virtualized surface (direct edits use a separate textarea view, see [File Editing](file-editing.md); larger changes go through a coding harness), it bypasses heavy third-party editor runtimes entirely. Instead, it implements a custom, high-performance virtualized surface with a fixed DOM footprint (~60 active nodes) and sub-millisecond paint budgets. This architectural choice keeps the frontend browser tab's RAM strictly bounded (~80–150 MB), ensuring that the combined client-server footprint (~100–180 MB) remains an order of magnitude leaner than Electron IDEs without suffering memory creep on large files.

## 2. DOM surface

```html
<div id="editor">
  <div id="viewport">          <!-- native scroller: overflow auto, contain strict -->
    <div id="sizer">           <!-- height = layout offset of the last line -->
      <div id="rows">          <!-- translateY(offset of the first mounted line) -->
        <div class="row" data-l="123"><div class="g">123</div><div class="c">…</div></div>
      </div>
      <div id="caret"></div>   <!-- overlay, translate(x, y) -->
    </div>
  </div>
</div>
```

`.g` is the sticky line-number gutter; `.c` holds the server's highlighted HTML for the line. The find bar, hover card, minimap and viewers are siblings inside `#editor`.

## 3. The visible window

The buffer keeps a layout offset for every line: `LH` (20 px) per line, or each line's measured height when wrapping. `visibleRange(offsets, scrollTop, height)` binary-searches those offsets for the first and last lines inside the view plus an overscan of 24 lines on each side. At desktop sizes that is 50 to 70 rows.

`Viewport` renders the range with `Index` slots, so scrolling reuses the same row components with new line numbers instead of creating elements. Scroll and resize write the viewport geometry once per animation frame. When a document is editing or showing a preview, diff or image, the range is empty: the hidden source view mounts no rows.

A resource keyed by the buffer and the range calls `buffer.ensure(first, last)`, which loads the missing 1,000-line windows from `/api/file`. A replaced key cancels its request. Lines from an inexact window (`refine: true`) are swapped for exact ones when the server's background pass finishes.

With word wrap on, a `ResizeObserver` on the mounted rows reports their heights to the buffer, which updates its offsets; unmeasured lines keep an estimate from the file's average line length.

## 4. Font measurement

`EditorMeasure` measures the character width of the editor font from a hidden 100-character sample, again after type settings change and once web fonts finish loading. The width and line height go into the editor geometry, so widths and positions are computed instead of read from row layout during scrolling.

## 5. Decorations

Rows never rewrite the server's HTML. Text-level marks are CSS Custom Highlights: each `EditorRow` computes text ranges in its own `.c` element for the symbol occurrence, find matches, the active match and the definition link under the pointer, and the shared registry in `highlights.js` adds them to named `Highlight` groups. Line-level states (caret line, selected lines, agent targets, reference ranges, Git gutter marks) are row classes derived from the store. Diagnostics set a `data-diag` attribute that CSS shows as a badge.

## 6. Caret and selection

The caret is an overlay under `#sizer`, positioned with `transform: translate(x, y)` from the caret line and column. Row markup stays plain code, so copying never picks up caret elements.

The document entry holds the caret (`cur`, `col`) and the selection anchor (`selAnchor`). Keyboard and Vim movement change those through named actions; `syncSelection` maps the anchor and caret to text with `selectedText` and applies a native selection through the viewport's `source` handle. Slots are reused while scrolling, so after the mounted window moves an effect restores the native selection in the next frame. `source-dom.js` converts between DOM points and `{ line, col }` positions inside the viewport's own rows.

## 7. Whole-file selection and selection actions

`Mod+A` outside a field does not use the browser's select-all, which would select sidebar text and miss off-screen lines. `selectAll` in [`selection-actions.js`](../../web/src/editor/selection-actions.js) reads the file once from `/api/raw` and sets a selection covering every line; `Mod+C` then copies all of it. Esc or a click clears it.

Any selection drives the footer selection bar (`#footer-sel`) and the right-click menu in [`SelectionBar.jsx`](../../web/src/editor/SelectionBar.jsx): Copy Ref, Copy with Context, Edit Inline, Find Usages and the `Alt` shortcuts. `runSelectionAction` performs them. A right click on a selection neither moves the caret nor collapses the selection. See [Harness Editing & Agent Dispatch](agent-editing.md).
