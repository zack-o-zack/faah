# Styling and themes

Frontend architecture and build commands: [Frontend implementation](frontend.md).


faah uses Tailwind CSS 4.3.5 and Basecoat 1.1.0 (Vega). Basecoat supplies the
components; vanilla JavaScript owns their behaviour. Basecoat JavaScript is not
loaded. There are no separate browser, workbench or desktop component sheets.

## Build and entry point

`web/tailwind.css` is the only stylesheet source outside the theme directory.
`node scripts/build-web.js` compiles it to the gitignored `web/dist/app.css`, then
bundles the editor, workbench and holding-page JavaScript. The Go server embeds
the generated assets, not the Tailwind source or npm dependencies. Pages load
`static/app.css` followed by `static/themes.css`.

The entry has these sections, in order:

1. **Imports:** Tailwind's preflight, theme and utilities, then Basecoat Vega.
2. **Sources:** `@source` scans the two HTML pages, `web/src/` and `internal/workbench/workbench.go`.
   The Go source matters because it contains the holding-page template.
3. **Variants:** `dark:` follows the root `.dark` class; `desktop:` matches
   `[data-shell]`; `win-linux:` matches the desktop platform attributes.
4. **Theme mapping:** `@theme inline` exposes faah colours, fonts and type sizes
   as utilities, such as `text-primary-text`, `bg-gi-bg` and `text-11`.
5. **Fonts and base layer:** system font defaults, browser and desktop type
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

## Theme contract

The built-in themes are `fibo-light` and `fibo-dark`. With no saved or configured
ID, `prefers-color-scheme: dark` selects fibo dark; otherwise fibo light. The
empty `workbench.colorTheme` setting means System. A configured nonempty ID wins
over the browser's saved ID. An unavailable ID follows the OS, with no migration
or alias. OS changes apply live while System is selected.

Every theme uses a unique ID made of letters, digits, underscores or hyphens in
`:root[data-theme="<id>"]`, `html[data-theme="<id>"]` or `[data-theme="<id>"]`.
Set `--theme-name: "Display name"` and `color-scheme: light` or `dark`.
The picker reads the loaded CSS, including blocks inside grouping rules and
comma-separated selectors. Later blocks override tokens without erasing earlier
name or scheme metadata. Theme files contain tokens, not component rules.

`createThemeStore` in `web/src/lib/theme.ts` sets `data-theme` and derives the
`.dark` class from the declared scheme. `setTheme(id, false)` previews a valid
ID without saving. `setTheme('')` saves System; unknown IDs are rejected. Server
settings endpoints validate picks against the same discovered IDs, and the
settings schema derives its options from the served CSS. Before the client
mounts, a small CSP-hashed inline script applies the configured theme or OS
default on editor, launcher and holding pages.

### User themes and overrides

Put user CSS in `~/.faah/themes/`. This data directory is independent of
`XDG_CONFIG_HOME` and `XDG_STATE_HOME`; those still control settings and state.
The server receives the data directory explicitly, so tests can supply a
temporary directory. No rebuild or JavaScript changes are needed for user CSS.

Load order is `static/app.css`, then `static/themes.css`. The latter contains
built-in files in filename order, then user `*.css` files in filename order.
Each file has a filename comment. Embedded built-ins are cached per server;
`FAAH_DEV_ROOT` re-reads built-ins from disk. User files are read on every
request, so reload the page after editing them. User CSS has a 256 KiB per-file
cap and a 1 MiB total content cap. Files exceeding either cap, unreadable files,
and non-regular entries are skipped with a log line. A missing folder is fine.

For example, `~/.faah/themes/overrides.css` changes two fibo dark tokens:

```css
:root[data-theme="fibo-dark"] {
  --spiral: #b8e6a0;
  --surface-raised: #202820;
}
```

Aliases use `var(--token)`, so changing a fibo token updates its Basecoat users.
Changing `--spiral` is available for the mark's later implementation; existing
logo files are unchanged in this colour-only phase.

### fibo colours

Define these first in both themes. Pastels are fills, paired with `on-pastel`.
Status also needs a sign, icon or text, such as `+`, `Passed` or `Error`.

| Tokens | Purpose |
| --- | --- |
| `--surface`, `--surface-raised`, `--surface-sunken` | Page/editor, floating/cards, sidebars/code blocks |
| `--ink`, `--ink-muted` | Primary and secondary text |
| `--line`, `--line-strong` | Decorative hairlines and control edges |
| `--spiral`, `--accent-ink` | Mark and action/link ink |
| `--pistachio` | Brand and primary-action fill |
| `--periwinkle` | Agent/model fill |
| `--aqua` | Addition/pass fill |
| `--lemon` | Matches and waiting-for-you fill |
| `--bubblegum` | File, selection and information fill |
| `--on-pastel` | Dark text on all five pastels, in either theme |
| `--danger`, `--danger-soft` | Error ink and error fill |
| `--focus`, `--hover` | Focus rings and row/menu hover |

### Basecoat aliases

Define these after the fibo colours, using references rather than repeated hex.

| Basecoat tokens | fibo token |
| --- | --- |
| `--background` / `--foreground` | `--surface` / `--ink` |
| `--card`, `--popover` | `--surface-raised` |
| `--card-foreground`, `--popover-foreground` | `--ink` |
| `--primary`, `--sidebar-primary` | `--pistachio` |
| `--primary-foreground`, `--sidebar-primary-foreground` | `--on-pastel` |
| `--secondary`, `--muted`, `--sidebar` | `--surface-sunken` |
| `--secondary-foreground`, `--sidebar-foreground` | `--ink` |
| `--muted-foreground` | `--ink-muted` |
| `--accent`, `--sidebar-accent` | `--hover` |
| `--accent-foreground`, `--sidebar-accent-foreground` | `--ink` |
| `--destructive` | `--danger` |
| `--border`, `--sidebar-border` | `--line` |
| `--input` | `--line-strong` |
| `--ring`, `--sidebar-ring` | `--focus` |

Basecoat continues to supply shapes and control sizes.

### App tokens

| Tokens | Purpose |
| --- | --- |
| `--image-dark`, `--image-light` | Dark/light contrast surfaces in the image viewer |
| `--faint`, `--primary-text` | Secondary text and action/link ink |
| `--special` | Agent ink, independent of syntax function ink |
| `--sel`, `--cur` | Bubblegum selection overlay and current-line fill |
| `--mark`, `--mark-active`, `--on-mark-active` | Translucent/solid lemon search fill and active-match text |
| `--warn` | Readable warning ink from the lemon family |
| `--gi`, `--gd` | Readable addition/removal ink |
| `--gi-bg`, `--gd-bg` | Translucent addition/removal row fills |
| `--destructive`, `--err` | Error ink for controls and syntax |
| `--shadow` | Floating-surface shadow, using the theme's shadow-pop value |

Root fallbacks are `--special: var(--nf)`, `--warn: var(--mark-active)`,
`--on-mark-active: var(--background)` and `--on-badge: var(--background)`.
The fibo themes explicitly replace the first three. `--on-badge` is optional;
it is text over syntax-coloured badges. Other contract tokens have no app-level
fallback and must be defined by a complete theme.

### Syntax tokens

The renderer emits short syntax classes. Define each token; the stylesheet
scopes them to code, Markdown fences, diffs and hover signatures.

| Tokens | Purpose and fibo role |
| --- | --- |
| `--k`, `--kt` | Keywords (indigo), types (amber) |
| `--nf`, `--nc`, `--nb` | Functions (green), classes (amber), built-ins (teal) |
| `--nv`, `--no` | Variables (ink), constants (rose) |
| `--na`, `--nt`, `--nd`, `--np` | Attributes (teal), tags (green), decorators (indigo), namespaces (muted ink) |
| `--s`, `--m` | Strings (teal), numbers (rose) |
| `--o`, `--p` | Operators and punctuation (muted ink) |
| `--c`, `--cp` | Comments (muted ink), preprocessor directives (indigo) |
| `--err`, `--gi`, `--gd` | Error, addition and removal ink |

`web/src/contrast.test.ts` resolves token references recursively, composites
alpha fills over `surface`, and checks text at 4.5:1 on all surfaces and `cur`.
Syntax also passes on composited selection and diff fills; diff ink passes on
its own fill; `on-pastel` passes on every pastel. Focus and control edges need
3:1 on surfaces. Keep these checks when changing a theme.

### A complete new user theme

Save this as `~/.faah/themes/my-theme.css` and reload. It adds `my-theme` to the
picker, using the complete dark token contract as a starting point. Change
colours and keep aliases as references; check contrast after editing.

```css
:root[data-theme="my-theme"] {
  --theme-name: "My theme";
  color-scheme: dark;

  /* fibo colours: pastels are fills; ink tones carry text. */
  --surface: #141815;
  --surface-raised: #1c221e;
  --surface-sunken: #0e110f;
  --ink: #edf3ec;
  --ink-muted: #a7b3aa;
  --line: #37413a;
  --line-strong: #768379;
  --spiral: #a8dc8c;
  --accent-ink: #a8dc8c;
  --pistachio: #a9d68a;
  --periwinkle: #a9b0f0;
  --aqua: #8ed3cf;
  --lemon: #e3d572;
  --bubblegum: #eda3c3;
  --on-pastel: #1d2620;
  --danger: #ff8796;
  --danger-soft: #5a2530;
  --focus: #b6bcfa;
  --hover: #262e28;

  /* Basecoat aliases follow the fibo colours. */
  --background: var(--surface);
  --foreground: var(--ink);
  --card: var(--surface-raised);
  --card-foreground: var(--ink);
  --popover: var(--surface-raised);
  --popover-foreground: var(--ink);
  --primary: var(--pistachio);
  --primary-foreground: var(--on-pastel);
  --secondary: var(--surface-sunken);
  --secondary-foreground: var(--ink);
  --muted: var(--surface-sunken);
  --muted-foreground: var(--ink-muted);
  --accent: var(--hover);
  --accent-foreground: var(--ink);
  --border: var(--line);
  --input: var(--line-strong);
  --ring: var(--focus);
  --sidebar: var(--surface-sunken);
  --sidebar-foreground: var(--ink);
  --sidebar-primary: var(--pistachio);
  --sidebar-primary-foreground: var(--on-pastel);
  --sidebar-accent: var(--hover);
  --sidebar-accent-foreground: var(--ink);
  --sidebar-border: var(--line);
  --sidebar-ring: var(--focus);

  /* Selection, search, status, image surfaces and elevation. */
  --image-dark: #141815;
  --image-light: #f6f8f4;
  --faint: var(--ink-muted);
  --primary-text: var(--accent-ink);
  --special: var(--periwinkle);
  --cur: var(--hover);
  --sel: rgba(237, 163, 195, 0.10);
  --mark: rgba(227, 213, 114, 0.20);
  --mark-active: var(--lemon);
  --on-mark-active: var(--on-pastel);
  --warn: var(--lemon);
  --gi: #8ed3cf;
  --gi-bg: rgba(142, 211, 207, 0.08);
  --gd: var(--danger);
  --gd-bg: rgba(90, 37, 48, 0.35);
  --destructive: var(--danger);
  --err: var(--danger);
  --shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.55);

  /* Syntax: indigo keywords; teal strings/built-ins; rose numbers/constants;
     green functions/tags; amber types/classes; muted comments/punctuation. */
  --k: #b6bcfa;
  --kt: #e3d572;
  --nf: var(--accent-ink);
  --nc: #e3d572;
  --nb: #8ed3cf;
  --nv: var(--ink);
  --no: #eda3c3;
  --na: #8ed3cf;
  --nt: var(--accent-ink);
  --nd: #b6bcfa;
  --np: var(--ink-muted);
  --s: #8ed3cf;
  --m: #eda3c3;
  --o: var(--ink-muted);
  --p: var(--ink-muted);
  --c: var(--ink-muted);
  --cp: #b6bcfa;
}
```

Colours live in theme files. Components use semantic utilities or `var(...)`.
Derived colours may use `color-mix` with tokens and `transparent`; do not add
colour literals outside theme files.

## Desktop shell and type scale

The desktop preload marks the root with `data-shell="desktop"`, `data-platform`
(`mac`, `win` or `linux`) and, where supported, `data-titlebar`. Browser tabs
leave these attributes unset. Use `desktop:` for shared shell layout and
`win-linux:` for the application-menu button; do not create another stylesheet.
Titlebar height and native window-control insets use `--titlebar-h`,
`--titlebar-left` and `--titlebar-right`. The workbench has a draggable empty strip;
interactive controls and overlays opt out of dragging.

`:root` uses `system-ui, sans-serif` for `--ui` and `ui-monospace, monospace`
for `--mono`. The app ships no font files; `editor.fontFamily` can override the
monospace stack with an installed font. `:root[data-shell]` keeps these font
defaults and maps the `--t-*` scale to 11, 12, 13, 14, 16 and 20 px.

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
- Keep generated `web/dist/app.css` out of commits. Add no stylesheet imports for a
  single feature and no npm dependency for prose styling.
- Run `npm run check`, `go test ./...` and `npm test --prefix desktop`. Inspect
  both a dark and a light theme, including desktop shell layout, when changing
  styling.

