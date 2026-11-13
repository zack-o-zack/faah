# Markdown Preview Implementation

This document describes how faah renders Markdown files: the server-side conversion, the browser-side sanitizer, and the logic that keeps the rendered view and the source view in step.

A Markdown tab (`.md` or `.markdown`) opens rendered by default. The reader switches to the raw source with the Preview / Source switch in the tab bar, the Preview button in the status bar, or Alt+M. The code lives in two files: [`internal/render/render.go`](../../internal/render/render.go) on the server and [`web/src/viewers/`](../../web/src/viewers/) in the browser (`PreviewViewer.jsx`, `PreviewContent.jsx`, `markdown-dom.js`, `preview-dom.js`).

## 1. Request Flow

```text
openFile(path)
  |
  |  GET /api/file            -> { lines, total, ..., markdown: true }
  v
document { markdown: true, view: 'markdown' }   -- viewMode() --> PreviewViewer mounts
  |
  |  GET /api/markdown        -> { path, html }   (goldmark, raw HTML kept)
  v
sanitizeHTML(html)          -- inert DOMParser document, allowlist
  |
  v
enhanceMarkdown()           -- alerts, code block wrappers, copy buttons, Mermaid mounts
  |
  v
#md article                 -- scroll restored or line / anchor applied
```

While the preview shows, the source viewport renders no rows; switching back mounts them from the same buffer, so the text is not fetched again.

## 2. Opening a Markdown Tab

`handleFile` in [`server.go`](../../server.go) adds `markdown: isMarkdown(rel)` to every `/api/file` response, and the document entry ([`web/src/editor/documents.js`](../../web/src/editor/documents.js)) records it. A new Markdown document opens in the preview when the `markdown.preview.open` setting is on; toggling the preview saves that setting, so the next file opens the same way.

- `previewKind(document)` in [`view.js`](../../web/src/viewers/view.js) returns `'markdown'`, `'table'` or `''`; `viewMode(document)` returns the view to show (`source` while editing, then image, diff, the chosen preview, or source).
- [`Viewers.jsx`](../../web/src/viewers/Viewers.jsx) mounts `PreviewViewer` for the preview views. Its resource fetches `/api/markdown`, keyed by the path, the buffer and its revision, so a replaced request is aborted and a stale reply is dropped.
- `PreviewContent` sanitizes the HTML in a memo, renders it into `#md`, enhances it and restores the saved scroll (`mdScroll`), or applies a pending line (`mdLine`) or anchor (`mdAnchor`).

A failed fetch (for example a file over 4 MB) shows the error with a Retry button in place of the preview; the Source switch still works.

## 3. Server Rendering
### Converter Configuration

`mdConverter` is a single goldmark instance built at package init:

```go
var mdConverter = goldmark.New(
	goldmark.WithExtensions(extension.GFM, extension.Footnote),
	goldmark.WithParserOptions(
		parser.WithAutoHeadingID(),
		parser.WithASTTransformers(util.Prioritized(lineMarker{}, 100)),
	),
	goldmark.WithRendererOptions(
		html.WithUnsafe(),
		renderer.WithNodeRenderers(util.Prioritized(fenceRenderer{}, 100)),
	),
)
```

- `extension.GFM` adds tables, task lists, strikethrough and autolinks. `extension.Footnote` adds footnotes.
- `html.WithUnsafe()` passes raw HTML through. READMEs depend on it for centred logos and `<details>`. Section 4 explains why this is safe.
- goldmark sorts node renderers by ascending priority and registers them in reverse, so the lowest number wins. `fenceRenderer` at 100 replaces the default HTML renderer's code block functions, which sit at 1000.

`renderMarkdown` normalizes CRLF to LF, then converts with a fresh `headingIDs` table in the parser context. The table must be per-request because it tracks which ids are already taken.

### Source Line Anchors

`lineMarker` is an AST transformer. It builds a sorted slice of newline byte offsets once, then walks the document and sets `data-line` on these node kinds: `Heading`, `Paragraph`, `List`, `ListItem`, `Blockquote`, `FencedCodeBlock`, `CodeBlock` and `Table`.

Container nodes such as lists and blockquotes own no source lines. `blockStart` descends through first children until it finds a block with lines and returns that segment's start offset. The line number is the count of newlines before that offset, plus one:

$$
\text{line} = \left|\{\, i : \text{nl}_i < \text{off} \,\}\right| + 1
$$

`sort.SearchInts(newlines, off)` returns that count in $O(\log n)$.

goldmark's HTML renderer writes node attributes for headings, paragraphs, lists, list items, blockquotes and tables, and `RenderAttributes` lets any `data-` attribute through its filters. `fenceRenderer` writes `data-line` on `<pre>` itself. A fenced block's line is its first content line, one below the opening fence.

### Heading IDs

goldmark's default id generator drops every non-ASCII character and turns `_` into `-`, which breaks tables of contents written for GitHub. `headingIDs` implements `parser.IDs` with GitHub's rules: lowercase, keep Unicode letters and digits, keep `-` and `_`, turn spaces into `-`, drop everything else, and suffix repeats with `-1`, `-2`.

| Heading text        | Id                   |
| ------------------- | -------------------- |
| `Getting Started!`  | `getting-started`    |
| `snake_case API`    | `snake_case-api`     |
| `Überblick`         | `überblick`          |
| `Getting Started`   | `getting-started-1`  |
| `???`               | `section`            |

### Fenced Code Highlighting

`renderFence` emits:

```html
<pre class="md-code" data-line="8" data-lang="go"><code><i class=k>func</i> <i class=nf>main</i>...</code></pre>
```

`highlightFence` looks up the fence's language with `lexers.Get` and calls `highlightLines`, the function the code view uses in [`internal/render/render.go`](../../internal/render/render.go). `Doc.tokenise` is now a thin wrapper around it. Both views therefore share lexers, the `classFor` token mapping, and the panic recovery that falls back to plain text. A theme colours both through the same CSS rules (`.c .k, .md-code .k`).

Two cases stay plain and HTML-escaped:

- Fences with no language. Guessing a language from content with `lexers.Analyse` is slow and often wrong.
- Fences over `maxFenceBytes` (256 KB).

### Endpoint

`GET /api/markdown?path=<path>` resolves the path with `resolvePath`, the same rule `/api/file` uses: inside the workspace, or an absolute path a language server has named. It reads the whole file and returns `{ "path": ..., "html": ... }`. It holds no cache. Every error comes back as JSON through `fail`:

| Status | Cause                                        |
| ------ | -------------------------------------------- |
| 400    | Path escapes the workspace                   |
| 415    | Not `.md` or `.markdown`, or a directory     |
| 404    | File missing or unreadable                   |
| 413    | Larger than `maxMarkdownBytes` (4 MB)        |
| 500    | goldmark returned an error                   |

## 4. Sanitization
### Why the Browser Treats the HTML as Untrusted

The preview renders on faah's own origin. That origin also serves `/api/lsp/install` and `/api/lsp/start`, which accept a POST whose `Origin` matches the host. Script injected into the preview would pass that check. A Markdown file in any repository the reader opens is attacker-controlled input, so every byte from `/api/markdown` goes through `mdSanitize` before it touches the page.

### Pipeline

`mdSanitize(html, docPath)` works in five steps:

1. Parse the HTML with `new DOMParser().parseFromString(html, 'text/html')`. A DOMParser document has no browsing context: it runs no script and loads no images.
1. Walk a static snapshot of `body.querySelectorAll('*')`, skipping elements already detached with a removed ancestor.
1. Remove, with all content, any element outside the HTML namespace or in `MD_DROP`: `script style iframe frame frameset object embed applet template noscript noembed svg math form textarea select option button link meta base title audio video source track canvas dialog`.
1. Unwrap any element not in `MD_KEEP`, keeping its children in place. An `<input>` survives only as `type="checkbox"` and is forced `disabled`.
1. Strip every attribute from kept elements, then restore only those that follow these rules:
  - Attributes in `MD_ATTRS`: `align valign alt title lang dir width height colspan rowspan start reversed open checked disabled type data-line data-lang`.
  - `id`, and `name` on `<a>`, rewritten as `id="md-<value>"`. A heading called "Status" becomes `md-status` and cannot shadow the status bar's `#status`.
  - Class tokens only when they are `md-code`, start with `footnote`, or are highlighter tokens on `<i>`. Content cannot borrow faah's layout classes such as `row`.
  - `src` and `href` through the URL rules below.

The cleaned children move into a `DocumentFragment` with `document.adoptNode`. The cleaned tree is never serialized and re-parsed, which rules out mutation XSS from parser round trips. `style` attributes never survive, so content cannot position an overlay over the UI.

### URL Rules

`mdURL` first removes tabs and newlines anywhere and control characters at either end, because the URL parser ignores them. Without this, `java&#9;script:` would slip past a scheme check.

| Reference                                   | `<a href>`                                                      | `<img src>`                        |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `#section`                                  | Kept, `data-anchor="section"`                                   | n/a                                |
| `http:`, `https:`, `//host`                 | Kept, `target="_blank" rel="noopener noreferrer"`               | Kept                               |
| `mailto:`                                   | Kept, new tab                                                   | Dropped                            |
| `data:image/...`                            | Dropped                                                         | Kept                               |
| Any other scheme (`javascript:`, `file:`)   | Dropped                                                         | Dropped                            |
| No scheme (`docs/a.md#x`, `../img.png`)     | `/api/raw?path=<resolved>` plus `data-path` and `data-anchor`   | `/api/raw?path=<resolved>`         |

`mdLocal` resolves a scheme-less reference with `new URL(ref, base)`, where `base` is the stand-in origin `http://faah.invalid/` plus the Markdown file's directory, each segment percent-encoded. A leading `/` resolves to the workspace root, as on GitHub. If the result lands on any other origin, the reference was not relative after all and gets no URL.

### Hostile Input Examples

These cases come from the browser checks run against the implementation:

| Input                                              | Result                                        |
| -------------------------------------------------- | --------------------------------------------- |
| `<script>window.__xss = 1</script>`                | Removed with its content                      |
| `<img src="x" onerror="...">`                      | `onerror` stripped, `src` becomes a raw path  |
| `<a href="javascript:...">`                        | Text kept, no `href`                          |
| `<a href="java&#x09;script:...">`                  | Text kept, no `href`                          |
| `<svg onload="...">`                               | Removed                                       |
| `<style>body { display: none }</style>`            | Removed                                       |
| `<div style="position:fixed;inset:0" class="row">` | Plain `<div>` with no style and no class      |
| `## Status`                                        | `<h2 id="md-status">`                         |

## 5. Presentation

`enhanceMarkdown` ([`markdown-dom.js`](../../web/src/viewers/markdown-dom.js)) runs after sanitization and adds markup that faah itself creates:

- GitHub alerts. A blockquote whose first paragraph opens with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` loses the marker, gains a `.md-alert-title` paragraph, and gets `.md-alert .md-alert-<kind>`.
- Code block wrappers. Each `<pre>` moves into `.md-pre`, which carries `data-lang` for a corner label and a copy button. The button holds an SVG icon rather than a text label, because find in the preview walks text nodes and would otherwise match the word "Copy".
- Mermaid diagrams. A fence whose `data-lang` is `mermaid` keeps its sanitized source block and copy button, then a `MermaidDiagram` component renders a diagram beside it. Successful renders hide the source block and provide per-diagram zoom controls; failed renders leave the source visible with a local error message.
- Inline image enhancements. Every kept `<img>` is injected with `loading="lazy"` and `decoding="async"`, preventing layout shifts and deferring offscreen network transfers. Standalone images receive `.md-zoomable`, affording hover highlights and zoom-in cursors.
- Lightbox. Clicking a standalone image opens `Lightbox.jsx`, a native modal dialog with **Open in tab** (promotes the image into an image tab) and **Copy path**; Escape or a backdrop click closes it.
- Broken image recovery. A capture-phase error listener on `#md` detects failed image loads and replaces the element with a styled `.md-img-broken` card displaying the missing path. See [Image Viewer Architecture](image-viewer.md) for full details.

Styles live in the Markdown section of `@layer components` in [`web/tailwind.css`](../../web/tailwind.css). They read only theme tokens, so all themes work without changes. Alerts set a local `--alert` property from existing tokens: Note `--primary`, Tip `--gi`, Important `--nc`, Warning `--mark-active`, Caution `--destructive`. [`styling-and-themes.md`](styling-and-themes.md) lists every token the preview uses.

### Mermaid Diagrams

Mermaid is a presentation-stage enhancement, not a server renderer. `renderFence` emits the same escaped `<pre><code>` and `data-line` metadata as every other fence. After the sanitizer has rejected repository-supplied SVG, `PreviewContent` mounts a [`MermaidDiagram`](../../web/src/viewers/MermaidDiagram.jsx) beside each Mermaid fence. [`mermaid-runtime.js`](../../web/src/viewers/mermaid-runtime.js) lazy-loads the pinned, same-origin `web/vendor/mermaid-12.0.0.min.js` asset. The runtime is fetched on demand and cached under the user cache directory (`~/.faah/cache/vendor/`), keeping the binary lean while diagrams work offline after the first fetch and under `-base-path`.

The runtime initializes Mermaid with `startOnLoad: false`, `securityLevel: strict`, disabled error rendering, and Mermaid's secure configuration keys. Diagram directives therefore cannot enable HTML labels, click callbacks, or a weaker security level. The returned `bindFunctions` hook is intentionally ignored.

Renders are serialized through one queue and cached by source and theme (at most 50 diagrams). Each diagram is a resource keyed by its source and the current theme, so a theme change re-renders it and a stale render is dropped. A syntax error affects only its fence: the source stays visible with a local error and neighbouring diagrams continue.

The original `<pre>` stays in the DOM after a successful render, hidden from presentation and find but available to the copy button and `domToMarkdown`, so copying keeps the exact Mermaid source. Each diagram has `MermaidControls`: zoom from 25% to 400% with a percentage label and fit-to-view, drag panning, and full screen. Full screen (`.md-mermaid.is-fullscreen`) fills the viewport, locks page scrolling and refits while keeping zoom and pan; the close buttons and Escape leave it.

## 6. Keeping the Reader's Place

Navigation in faah is line-based: the outline, go to line, search results, references, history, and `openFile(path, { line })`. All of them call `centerLine(n)` in [`editor/store.ts`](../../web/src/editor/store.js), which records the line on the document (`mdLine`) and asks the preview's `line(n)` handle to scroll while previewing.

### Line to Block (`line`)

`line(n)` in [`preview-dom.js`](../../web/src/viewers/preview-dom.js) picks the element with the largest `data-line` that is at most `n` and scrolls it to a gap (16 px, or the table header's height) below the top edge. It picks the largest line rather than stopping at the first one past `n`, because footnote definitions render at the end of the document but can sit anywhere in the source.

If the HTML has not arrived yet, the line waits in `mdLine` and `PreviewContent` applies it after rendering. Links to another file's heading wait the same way in `mdAnchor`.

### Block to Line (`topLine`)

`topLine()` walks `[data-line]` elements in document order and returns the last one whose top edge sits within the gap plus 8 px of the view's top. The tolerance has to exceed the gap; otherwise a heading just scrolled into place by `line(n)` would report the block above it.

### Switching Views

`togglePreview(document, line)` in [`viewers/actions.ts`](../../web/src/viewers/actions.js) stores the line and flips the view. The switch passes the reader's position in each direction: from the preview, `topLine()` of the preview handle; from the source, the source view's top line. The source view then centres that line, and the preview scrolls its block into place once drawn.

## 7. Links and History

`PreviewContent` routes plain left clicks on `#md`. Modified clicks fall through to the browser, which opens the `/api/raw` href in a new tab.

- A copy button copies its code block's text.
- A zoomable image opens the lightbox.
- `data-anchor` without `data-path`, or a link to the current file, pushes the current position to history and scrolls to the anchor, so Alt+Left and Alt+Right move between the two.
- `data-path` pushes history and calls `openLink` ([`tree-store.js`](../../web/src/workspace/tree-store.js)), which reveals a folder in the explorer or opens a file. A `#L12` anchor opens the file at line 12; any other anchor opens the file and then scrolls to the heading through `mdAnchor`.
- A path that fails to open shows a toast.

## 8. Switch Controls

Three controls call `togglePreview()`:

| Control                          | Location                               | Wiring                                         |
| -------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Preview / Source switch          | `#md-switch`, right end of the tab bar | `FileActions.jsx`                              |
| Preview button                   | Status bar                             | `StatusActions.jsx`                            |
| Alt+M, "Toggle Markdown / Table Preview" | Keyboard, command palette      | `GlobalShortcuts.tsx`, `palette/features.ts`  |

The switch and the status button show only on Markdown and CSV/TSV tabs (labelled Table on the latter) and derive their state from `viewMode`. Clicking the half that is already selected does nothing.

## 9. Find, Select All and Keys

The code view's features assume rows, so the preview registers its own versions as the `preview` handle:

- Find (Ctrl+F). The find actions ([`find-actions.js`](../../web/src/editor/find-actions.js)) call `preview.find(query, caseSensitive)` instead of `/api/search`. It clears earlier `mark.md-hit` elements and marks matches in text nodes, case-insensitively unless Match case is on. Hidden Mermaid source is excluded so matches correspond to visible content. Stepping calls `preview.showHit(index)`, which scrolls the match to the middle of the view.
- Select all (Ctrl+A). `preview.select()` selects the contents of `#md` natively instead of the whole-file selection, so Ctrl+C copies the rendered text.
- Scrolling. `preview.key(event)` maps ArrowUp and ArrowDown (and `k` / `j`) to 48 px, PageUp and PageDown to 90% of the view, and Home and End (Cmd+Up and Cmd+Down on macOS) to the ends. `GlobalShortcuts` calls it for keys no other binding took.

Hover cards, Ctrl+click definitions and the selection bar belong to the source viewport, which renders no rows under the preview, so none of them fire there. Text selected in the preview still reaches the selection bar through `selectionchange`, for the copy actions that apply to rendered text.

## 10. Limits and Known Gaps

- Markdown files over 4 MB are not previewed. CSV and TSV files show their first 1,000 rows or 1 MB (section 12).
- Fences over 256 KB and fences without a language are not highlighted.
- Math fences render as code blocks.
- Images that load after a scroll position is restored can push content down.
- Relative images in a Markdown file outside the workspace (opened through a language server) do not load, because `/api/raw` accepts only workspace paths.
- The selection bar and right-click menu actions (Copy Ref, Copy with Context, Edit Inline, Find Usages) do not act on text selected in the preview. Switch to Source to edit.

## 11. Tests

[`markdown_test.go`](../../markdown_test.go) covers the server side:

- `TestMarkdownPreview` checks heading ids and `data-line`, highlighted fenced code, preserved relative links, task list checkboxes, the `markdown` flag on `/api/file`, and the 415 and 400 responses.
- `TestHeadingIDsFollowGitHub` checks the id rules and deduplication.

Browser tests run in Vitest with jsdom: [`markdown.test.js`](../../web/src/viewers/markdown.test.js) (sanitizer, URL rules, selection serialization, broken images), [`markdown-picture.test.js`](../../web/src/viewers/markdown-picture.test.js), [`mermaid-logic.test.js`](../../web/src/viewers/mermaid-logic.test.js) and [`viewers.test.jsx`](../../web/src/viewers/viewers.test.jsx) (views, preview find and handles). Layout-dependent behaviour (scroll positions, Mermaid output) is checked in a real browser.

## 12. Table Preview (CSV / TSV)

CSV and TSV tabs reuse this overlay. `/api/file` returns `"table": true` for `.csv` and `.tsv`, the document records `table`, and `previewKind` returns `'table'`. Each kind keeps its own setting (`markdown.preview.open` / `table.preview.open`). Everything else in sections 6–9 (position sync, switch, find, select all, keys) is shared, because table rows carry `data-line` the same way Markdown blocks do.

### Endpoint

`GET /api/table?path=<path>` ([`internal/table/table.go`](../../internal/table/table.go)) resolves the path like `/api/markdown`, answers 415 for other extensions, and parses with `encoding/csv` (`LazyQuotes`, `FieldsPerRecord = -1`). `Comma` comes from `sniffDelim`: it peeks at the first 64 KB, takes the first non-blank line, and counts comma, tab, semicolon and pipe outside double quotes. The most frequent wins, and the extension's separator (`.csv` → comma, `.tsv` → tab) wins ties and files with none. Misnamed files are common: a tab-separated `.csv` read with commas comes out as one cell per line. The first record is the header, with a leading UTF-8 BOM removed. It returns:

```json
{ "header": ["repo", "files"], "headerLine": 1,
  "rows": [{ "line": 2, "cells": ["linux", "81902"] }],
  "cols": 2, "truncated": false }
```

`line` is `csv.Reader.FieldPos(0)`: the line the record's first cell starts on. Quoted cells that span lines and skipped blank lines therefore keep row numbers equal to source lines.

### Caps

`renderTable(r, size, fallback)` reads through `io.LimitReader(r, 1 MiB)` and stops after 1,000 data rows, so cost is bounded by the cap, not the file (a 50 MB file answers in well under a second). When the limit reader stops short of the end of the file (`size` over the cap), the last record may be cut in half: it is dropped and `truncated` is set. A parse error under the byte cap is ignored for the same reason. An error in a file read to its end returns 422.

### Rendering

[`TableViewer.jsx`](../../web/src/viewers/TableViewer.jsx) renders the rows with `For` and `Index`; every cell is text, nothing from the file is parsed as HTML, so the table needs no sanitizer. The article's class is `csv` (the `.md` styles do not apply). Cells use `white-space: pre-wrap` with `max-width: 48ch` and `overflow-wrap: break-word`, so long text wraps inside its column (checked in Chromium, WebKit and Firefox, which all honour `max-width` on cells of a `width: max-content` table). The header `th` cells and the `.ln` gutter are `position: sticky`; the preview handle uses the header row's height as its gap, so `line(n)` places a row just under the pinned header instead of behind it. The header row is skipped as a scroll target (a line at or before it scrolls to the top), and `topLine()` returns the header's line while the table is unscrolled. Find skips the `.ln` gutter and the footer, so counts and stepping cover cells only. The footer's **Open Source** button calls `togglePreview()`. It states the number of rows shown and the file's line count; counting rows in the whole file would mean parsing all of it.

### Tests

[`table_test.go`](../../table_test.go) holds the parsing rules (quoted comma and newline, line skipping, ragged rows, TSV, BOM, blank lines, stray quotes, empty file, row cap, exactly-at-cap), separator detection and ties, the endpoint and `table` flag, and the byte cap: an endless reader proves no more than 1 MiB is read and that the record the cap cuts through is dropped. The browser behaviour was checked with a headless Playwright run in Chromium, WebKit and Firefox; there is no browser test in the repository.
