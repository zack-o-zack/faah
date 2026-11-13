# Styling and themes

Frontend migration conventions and build commands: [Frontend implementation](frontend.md).


faah uses Tailwind CSS 4.3.5 and Basecoat 1.1.0 (Vega). Basecoat supplies the
components; vanilla JavaScript owns their behaviour. Basecoat JavaScript is not
loaded. There are no separate browser, workbench or desktop component sheets.

## Build and entry point

`web/tailwind.css` is the only stylesheet source outside the theme directory.
`node scripts/build-web.js` compiles it to the gitignored `web/app.css`, then
bundles the editor, workbench and holding-page JavaScript. The Go server embeds
the generated assets, not the Tailwind source or npm dependencies. Pages load
`static/app.css` followed by `static/themes.css`.

The entry has these sections, in order:

1. **Imports:** Tailwind's preflight, theme and utilities, then Basecoat Vega.
2. **Sources:** `@source` scans the two HTML pages, `web/src/` and `workbench.go`.
   The Go source matters because it contains the holding-page template.
3. **Variants:** `dark:` follows the root `.dark` class; `desktop:` matches
   `[data-shell]`; `win-linux:` matches the desktop platform attributes.
4. **Theme mapping:** `@theme inline` exposes faah colours, fonts and type sizes
   as utilities, such as `text-primary-text`, `bg-gi-bg` and `text-11`.
5. **Fonts and base layer:** bundled Inter font faces, browser and desktop type
   scales, titlebar geometry, page defaults, scrollbars and `[hidden]` enforcement.
6. **Components layer:** code-selection state, syntax spans, Markdown prose,
   Mermaid output, CSV tables, edit-mode measurement, diff rows, diagnostics,
   minimap hits and keyframes. These rules style renderer output or states that
   cannot be expressed on a fixed component's markup. Short section comments
   group them by feature.

Components come before Tailwind utilities in the cascade. A utility overrides a
component rule even if that rule has a more specific selector. When a utility
owns a property's default, put its state changes in variants too. For example,
code rows use `[body.word-wrap_&]:h-auto` alongside their fixed-height utility.
This prevents a component rule from silently losing to the utility layer.

## Components and controllers

Use Basecoat's components first: `btn`, `input`, `card`, `item`, `empty`, `badge`,
`dialog`, `dropdown-menu`, `tabs`, `kbd`, `command` and `toast`. Use their normal
variants and sizes through `data-variant` and `data-size`. Add layout utilities
for flex/grid placement, gaps, positioning, width, height and overflow only where
the screen needs them. Do not recreate an old control's appearance with size,
colour or radius overrides.

faah's own modules still open dialogs, navigate menus, position popovers and
manage keyboard focus. Basecoat CSS does not require its JavaScript controller.
Keep existing IDs, roles, accessibility attributes, `hidden`, titles and data
hooks when changing markup. Use `[hidden]`, not an invisible overlay, to remove
closed surfaces from layout and pointer handling.

The workbench uses cards for its Recent and Browse panels, items for folder and
workspace rows, a dropdown menu for path completion, and normal buttons and
inputs for actions. The holding page uses the same card and button components;
its JavaScript applies the configured theme without persisting a preference and
polls only while a workspace is starting.

## Themes

Each `web/themes/<id>.css` file declares tokens on `:root[data-theme="<id>"]`.
The server joins these files into `static/themes.css`. The theme picker discovers
them from the loaded CSS rules, reading `--theme-name` and `color-scheme`; there
is no second registry to maintain. Theme files hold tokens, not component rules.

`createThemeStore` in `web/src/lib/theme.js` sets `data-theme` and synchronizes
the `.dark` class with the theme's declared `color-scheme`. Call
`setTheme(id, false)` for a temporary preview; the default call also saves the
preference. Mermaid and other rendered previews read the store's current theme,
so they update when it changes.

To add a theme, copy a theme file, choose a unique ID and display name, set
`color-scheme`, and supply all the colour tokens. Rebuild the embedded app, or
reload with `FAAH_DEV_ROOT` pointing at the checkout. No JavaScript changes are
needed. Check code, Markdown, selected text, diffs, menus and focus states in
the new theme.

### Basecoat tokens

| Tokens | Purpose |
| --- | --- |
| `--background`, `--foreground` | Main editor surface and text |
| `--card`, `--card-foreground` | Cards |
| `--popover`, `--popover-foreground` | Floating surfaces |
| `--secondary`, `--secondary-foreground` | Secondary controls |
| `--muted`, `--muted-foreground` | Subdued surfaces and text |
| `--accent`, `--accent-foreground` | Hover and selected surfaces |
| `--primary`, `--primary-foreground` | Primary controls and their text |
| `--destructive` | Errors and destructive actions |
| `--border`, `--input`, `--ring` | Borders, input edges and focus rings |
| `--sidebar`, `--sidebar-foreground`, `--sidebar-border` | Sidebar surfaces |
| `--sidebar-accent`, `--sidebar-accent-foreground` | Sidebar hover state |
| `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-ring` | Sidebar primary and focus states |

Basecoat supplies its radius scale. Do not add separate control-radius, height
or spacing token families to imitate a previous design.

### faah tokens

| Tokens | Purpose |
| --- | --- |
| `--faint`, `--primary-text` | Tertiary text and accent-coloured text |
| `--sel`, `--cur` | Code selection and current-line background |
| `--mark`, `--mark-active`, `--on-mark-active` | Find matches and active-match text |
| `--on-badge` | Text over syntax-coloured badges; defaults to the main background |
| `--shadow` | Elevation for generated diagram controls and image previews |
| `--warn` | Warning state; defaults to the theme's active-match colour |
| `--gi`, `--gd`, `--gi-bg`, `--gd-bg` | Added/deleted text, markers and row backgrounds |
| `--image-dark`, `--image-light` | Image-viewer contrast surfaces |

Colours live in theme files. Elsewhere, use semantic utilities or `var(...)`.
Derived colours may use `color-mix` with tokens and `transparent`; never add a
literal hex, RGB or OKLCH value, including as a fallback.

### Syntax tokens

`internal/render` emits short Chroma classes. The components layer scopes their
colours to code cells, Markdown fences, diff cells and hover signatures.

| Token / class | Meaning |
| --- | --- |
| `--k` / `.k`, `--kt` / `.kt` | Keywords and types |
| `--nf` / `.nf`, `--nc` / `.nc`, `--nb` / `.nb` | Functions, classes and built-ins |
| `--nv` / `.nv`, `--no` / `.no` | Variables and constants |
| `--na` / `.na`, `--nt` / `.nt`, `--nd` / `.nd`, `--np` / `.np` | Attributes, tags, decorators and namespaces |
| `--s` / `.s`, `--m` / `.m` | Strings and numbers |
| `--o` / `.o`, `--p` / `.p` | Operators and punctuation |
| `--c` / `.c`, `--cp` / `.cp` | Comments and preprocessor directives |
| `--err` / `.err` | Syntax errors; separate from UI destructive state |
| `--gi` / `.gi`, `--gd` / `.gd` | Added and deleted text |

Supply these tokens in every theme. Code-cell geometry lives in renderer
utilities, so the short `.c` syntax class does not accidentally inherit the
layout of an outer code cell.

## Desktop shell and type scale

The desktop preload marks the root with `data-shell="desktop"`, `data-platform`
(`mac`, `win` or `linux`) and, where supported, `data-titlebar`. Browser tabs
leave these attributes unset. Use `desktop:` for shared shell layout and
`win-linux:` for the application-menu button; do not create another stylesheet.
Titlebar height and native window-control insets use `--titlebar-h`,
`--titlebar-left` and `--titlebar-right`. The workbench has a draggable empty strip;
interactive controls and overlays opt out of dragging.

`:root[data-shell]` changes `--ui` to bundled Inter and maps the `--t-*` scale to
11, 12, 13, 14, 16 and 20 px. `@font-face` URLs are relative to `static/app.css`,
so keep them as `fonts/...`. Browser defaults remain in `:root`.

| Tokens | Browser sizes | Desktop sizes |
| --- | --- | --- |
| `--t-8-5` through `--t-11` | 8.5–11 px | 11 px |
| `--t-11-5`, `--t-12`, `--t-12-5` | 11.5, 12, 12.5 px | 12 px |
| `--t-13`, `--t-13-5` | 13, 13.5 px | 13 px |
| `--t-14`, `--t-14-5` | 14, 14.5 px | 14 px |
| `--t-15`, `--t-16` | 15, 16 px | 16 px |
| `--t-18` | 18 px | 20 px |

The mappings expose utilities such as `text-12-5`. Use Basecoat defaults for new
controls, rather than choosing a bespoke size. Code still uses `--mono`, `--fs`
and `--lh`, with `--tab-size` controlled by editor settings. The type-scale test
scans source files and requires every used `--t-*` token to have both browser
and desktop definitions and a Tailwind mapping.

## Runtime content

A compact handwritten prose block restores headings, lists, tables, links,
quotes and code fences for sanitized Markdown. There is no typography plugin.
`.md` is the document preview; `.thr-body` is compact thread prose. Image
fallbacks and generated Mermaid canvases stay with these rules.

CSV/TSV previews switch the article from `.md` to `.csv`; sticky headers and line
gutters use the same border and surface tokens. Missing cells use a token-based
hatch. Diff rules use the added/deleted colour families, not fixed red or green.
Mermaid receives a theme derived from computed tokens, renders in strict mode,
and supports zoom, pan and full screen without accepting repository-supplied SVG.

Keep CSS here only when it styles generated content or shared runtime state.
If JavaScript constructs a control or wrapper, put its Basecoat and layout
classes in that markup instead. Use `@apply` when it makes a retained rule
shorter, not to hide a second component system.

## Contributor checklist

- Choose a Basecoat component before adding custom CSS.
- Use layout utilities and complete literal class strings in JavaScript. Select
  between full strings; never construct utilities such as `'text-' + size`.
- Use theme tokens only. Do not add colour literals outside `web/themes/`.
- Preserve behaviour and accessibility hooks; do not load Basecoat JavaScript.
- Keep generated `web/app.css` out of commits. Add no stylesheet imports for a
  single feature and no npm dependency for prose styling.
- Run `npm run check`, `go test ./...` and `npm test --prefix desktop`. Inspect
  both a dark and a light theme, including desktop shell layout, when changing
  styling.

