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
5. **Fonts and base layer:** bundled font faces, browser and desktop type
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

The built-in themes are `light` and `dark`. With no saved or configured
ID, `prefers-color-scheme: dark` selects Dark; otherwise Light. The
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

For example, `~/.faah/themes/overrides.css` changes two Dark tokens:

```css
:root[data-theme="dark"] {
  --surface-raised: var(--surface);
  --hover: var(--surface-sunken);
}
```

Aliases use `var(--token)`, so changing a fibo token updates its Basecoat users.
Changing `--spiral` is available for the mark's later implementation; existing
logo files are unchanged in this colour-only phase.

### fibo colours

Define these first in both themes. Surfaces and controls are neutral.
The brand green (`--spiral`) is reserved for the logo, the threads panel's thinking spiral and the two agent send buttons.
Pull request states have their own tokens (`--state-open`, `--state-merged`, `--state-closed`,
`--state-draft`, `--on-state`); user themes that omit them fall back to `--gi`, `--k`,
`--destructive` and `--muted-foreground`.
Status also needs a sign, icon or text, such as `+`, `Passed` or `Error`.

| Tokens | Purpose |
| --- | --- |
| `--surface`, `--surface-raised`, `--surface-sunken` | Page/editor, floating/cards, sidebars/code blocks |
| `--ink`, `--ink-muted` | Primary and secondary text |
| `--line`, `--line-strong` | Decorative hairlines and control edges |
| `--spiral`, `--on-spiral` | Green mark/send fill and its paired send text |
| `--danger`, `--danger-soft` | Error ink and error fill |
| `--focus`, `--hover` | Focus rings and row/menu hover |

### Basecoat aliases

Define these after the fibo colours, using references rather than repeated hex.

| Basecoat tokens | fibo token |
| --- | --- |
| `--background` / `--foreground` | `--surface` / `--ink` |
| `--card`, `--popover` | `--surface-raised` |
| `--card-foreground`, `--popover-foreground` | `--ink` |
| `--primary`, `--sidebar-primary` | `--ink` |
| `--primary-foreground`, `--sidebar-primary-foreground` | `--surface` |
| `--secondary`, `--muted`, `--sidebar` | `--surface-sunken` |
| `--secondary-foreground`, `--sidebar-foreground` | `--ink` |
| `--muted-foreground` | `--ink-muted` |
| `--accent`, `--sidebar-accent` | `--hover` |
| `--accent-foreground`, `--sidebar-accent-foreground` | `--ink` |
| `--destructive` | `--danger` |
| `--border`, `--sidebar-border` | `--line` |
| `--input` | `--line-strong` |
| `--ring`, `--sidebar-ring` | `--focus` |

Basecoat supplies control sizes; the fibo layer below owns their shapes.

### App tokens

| Tokens | Purpose |
| --- | --- |
| `--image-dark`, `--image-light` | Dark/light contrast surfaces in the image viewer |
| `--faint`, `--primary-text` | Secondary text and action/link ink |
| `--special` | Agent ink, independent of syntax function ink |
| `--sel`, `--cur` | Blue selection overlay and current-line fill |
| `--mark`, `--mark-active`, `--on-mark-active` | Translucent/solid yellow search fill and active-match text |
| `--warn` | Readable warning ink from the amber family |
| `--gi`, `--gd` | Readable addition/removal ink |
| `--gi-bg` | Opaque added-line fill in editor and review diffs |
| `--gd-bg` | Opaque deleted-line fill in editor and review diffs |
| `--gi-word` | Opaque added-word highlight within an added line |
| `--gd-word` | Opaque deleted-word highlight within a deleted line |
| `--destructive`, `--err` | Error ink for controls and syntax |
| `--shadow-raise`, `--shadow-pop`, `--shadow-dialog` | Selected/focused, floating and modal elevation |

Root fallbacks are `--special: var(--nf)`, `--warn: var(--mark-active)`,
`--on-mark-active: var(--background)` and `--on-badge: var(--background)`.
The fibo themes explicitly replace the first three. `--on-badge` is optional;
it is text over syntax-coloured badges. The shape layer also supplies these fallbacks for older user themes:

| Optional token | Root fallback |
| --- | --- |
| `--spiral` | `var(--primary-text)` |
| `--on-spiral` | `var(--background)` |
| `--shadow-raise`, `--shadow-pop`, `--shadow-dialog` | The legacy `--shadow`, if present; otherwise a foreground-tinted shadow for each elevation |

The bundled themes provide explicit neutral and elevation values. A user theme
can override any optional token. Check `on-spiral` contrast against `spiral`;
the fallback preserves the theme's background rather than guaranteeing contrast
for every possible custom palette. Other contract tokens must be defined by a
complete theme.

### Syntax tokens

The renderer emits short syntax classes. Define each token; the stylesheet
scopes them to code, Markdown fences, diffs and hover signatures.

| Tokens | Purpose and fibo role |
| --- | --- |
| `--k`, `--kt` | Keywords (indigo), types (amber) |
| `--nf`, `--nc`, `--nb` | Functions (blue), classes (amber), built-ins (blue) |
| `--nv`, `--no` | Variables (ink), constants (rose) |
| `--na`, `--nt`, `--nd`, `--np` | Attributes (blue), tags (blue), decorators (indigo), namespaces (muted ink) |
| `--s`, `--m` | Strings (blue), numbers (rose) |
| `--o`, `--p` | Operators and punctuation (muted ink) |
| `--c`, `--cp` | Comments (muted ink), preprocessor directives (indigo) |
| `--err`, `--gi`, `--gd` | Error, addition and removal ink |

`web/src/contrast.test.ts` resolves token references recursively, composites
alpha fills over `surface`, and checks text at 4.5:1 on all surfaces and `cur`.
Syntax also passes on composited selection and diff fills; diff ink passes on
its own fill; `on-spiral` passes on `spiral` at 4.5:1. Focus and control edges need
3:1 on surfaces. Keep these checks when changing a theme.

### A complete new user theme

Copy [dark.css](../../web/themes/dark.css) or [light.css](../../web/themes/light.css)
to `~/.faah/themes/my-theme.css`. Change `data-theme` to `my-theme`, give it a
unique `--theme-name`, and keep its `color-scheme`. Reload to discover the new
ID. Keep aliases as references and check contrast after editing colours.

Colours live in theme files. Components use semantic utilities or `var(...)`.
Derived colours may use `color-mix` with tokens and `transparent`; do not add
colour literals outside theme files.

## Icons

Icons are Phosphor, regular weight, from `@iconify-json/ph` via the Tailwind
Iconify plugin: `icon-[ph--name]`, in `ink` or `ink-muted`.
Use `-fill` only for a filled state mark. No emoji as icons.
Agent actions use the static eight-ray `ph--spinner` burst.

File-type icons come from `fileIcon()` in `web/src/lib/file-icon.ts`. The
explorer, tabs and palette file rows share monochrome Phosphor `file-*` icons,
with `file-code` for other supported code formats and `file-text` as the default.

Every icon is one size, `--icon-size` (16px), set by one unlayered rule in
`web/tailwind.css` that also stops icons from shrinking in flex rows. Don't add
`size-*` utilities to icons. A caret that opens a row turns with `rotate-90`.
Don't draw carets with borders. Live spirals are 18px wide.

Existing `size-*` utilities size the masks at `1em`; the 256-unit viewBox does
not change the CSS size. Use `circle-notch animate-spin` for plain spinners.
Only busy states in the threads panel keep the shared Spiral. Other AI busy
states use `icon-[ph--spinner] motion-safe:animate-spin`, retaining the idle
starburst's colour and global icon size. Markdown alert and external-link
masks also use Phosphor regular. The web build replaces Basecoat's embedded
caret/check artwork with the same set, preserving its theme colour and opacity.

The set has no draft or closed pull-request variant. Use `pencil-line` for a
draft and `prohibit` for a closed request, keeping both distinct from open
`git-pull-request` and merged `git-merge`. `sidebar-simple` depicts a left
sidebar, so mirror it with `-scale-x-100` for the right-inspector action.

## Shape, depth and keyboard focus

Brand shape and motion live in the base `:root` of `web/tailwind.css`, shared by
all themes. `@theme inline` bridges the radius and shadow names to utilities
without another set of values. The explicit radius scale replaces Basecoat's
calculated scale. `--radius` keeps Basecoat's 0.625rem base; each named radius
is explicit, so its old calculated offsets do not alter the fibo scale.

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-sm` | 6px | Keys and menu rows |
| `--radius-md` | 10px | Inputs, tabs, dropdowns and popovers |
| `--radius-lg` | 14px | Tab rails and empty states |
| `--radius-xl` | 20px | Cards, dialogs, command palette and prompt boxes |
| `--radius-2xl` | 24px | Toasts and chat bubbles |
| `--radius-pill` | 999px | Buttons, badges and chips |

The commented **fibo layer** follows the Basecoat imports inside
`@layer components`. It matches Vega's compact-button, tab, field and popover
selectors where necessary. Utilities retain their later cascade layer, so an
explicit `rounded-md` still overrides a button's pill shape. Avoid those
exceptions in product markup; use the component's shape by default.

View switches use the tabs rail. One-choice filters and options use ButtonGroup
with one variant for every segment, never swap variants per segment. The Ink
selection uses `foreground` fill and `background` text for selected rail tabs
and pressed group segments, including checked review verdict radios. Rails have one `input` border; every group segment
keeps that same border colour in either state.

Button groups have square seams and rounded outer ends, including vertical,
single-child and wrapped menu triggers. Vega marks its last-end radius important;
the group scopes its `--radius-md` input to the pill or vertical-end token rather
than adding important declarations. Icon-only buttons keep Basecoat's square
size and become circles. Cards, inputs and buttons remain flat. Selected tabs
use `shadow-raise`; text-field groups use it during mouse or keyboard focus.
Popovers, dropdowns, toasts and floating custom cards use `shadow-pop`.
Dialogs and the command palette use `shadow-dialog`, with nested floating
components flattened. Selected rail tabs retain `shadow-raise` inside dialogs.
Shadows set `--tw-shadow` to preserve Tailwind's composed border rings. The old
`--shadow` has no direct consumers and is supported only as an optional legacy
fallback for user themes.

Standalone Basecoat fields (`.input`, `.textarea` and `.field > input/select/textarea`),
buttons, badges, tabs, items and menus get a solid 2px `--focus` keyboard outline
with a 2px offset, falling back to `--ring` in older themes. Their focus rings
are cleared so they do not stack with the outline. Custom buttons, links,
summaries, `[tabindex]` controls and bare checkboxes/radios use a separate
low-specificity `:where(...)` rule, which local styles can override. Checked
checkbox/radio edges and active switch tracks use `--ink`.

Bare text inputs, selects and textareas are deliberately absent from that rule.
Use a Basecoat field for a standalone control. Within `.input-group`, use bare
direct children: Basecoat makes them transparent, borderless and outline-free.
The group owns the `--card` fill (`--surface-raised` in fibo), radius, `--focus`
border and `shadow-raise` on `:focus-within`, with no ring. Mouse and keyboard
focus look the same, including inside dialogs. Buttons inside a group keep
their own keyboard outline because they are separate actions.

FindBar and settings search use `.input-group`. Search-panel inputs remain
separate `.input` fields. The command palette marks its search-header border;
the model picker marks its existing header divider. Neither draws an inner
input outline.
The code reader's `#viewport` keeps a keyboard outline, inset 2px so the editor
edges cannot clip it. The edit-mode textarea stays outline-free, with its text
caret indicating focus. Markdown task checkboxes are disabled content, so they
are not keyboard stops. This revision has no inline tree rename field.

The `special` button variant uses the neutral `--hover` fill, `--ink` text and
an inset `--line` border. Hover and expanded states mix 8% ink into the fill.
The `send` variant uses `--spiral` and `--on-spiral`; hover mixes 8% ink.
Both variants retain Basecoat's disabled treatment. The thread and review
agent send buttons use green, as does Open PR status. A running thread's stop
action stays primary.

All badge `data-tone` and symbol `data-k` values use `--surface-sunken`, `--ink`
and a `--line` border. Open, Closed and Merged PR statuses use green, red and
indigo ink, tinted fills and matching borders. Draft badges retain muted text
and an outlined card fill. Secondary count badges use foreground
fill and background text. Destructive badges use destructive fill and its
paired foreground. Links remain underlined, with a 2px underline offset in
Markdown and thread prose.

The footer and Color Theme setting share a compact System / Light / Dark icon
radiogroup. Arrow keys wrap between options; Home/End select the first/last.
Selection follows the preference, so System stays checked while the OS changes.
Settings shows a separate user-theme select only when extra IDs are discovered;
no built-in segment is checked while a user theme is active.

Check proportions use Basecoat progress markup. Passed, failed and running
segments have semantic solid fills; skipped and neutral segments have an input
outline with background fill. Two-pixel gaps distinguish adjoining states, and
flex weights preserve their relative proportions. Review verdict radios have one
keyboard stop, with arrows and Home/End selecting enabled choices. The Git sync
split action uses outline on both buttons with one shared border colour. Text counts and icons remain
available so colour is not the only signal. Link variants use
`--primary-text` for readable text.

Motion tokens are `--duration-fast: 120ms`, `--duration-base: 200ms` and
`--duration-slow: 300ms`. Curves are `--ease-out:
cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-in-out:
cubic-bezier(0.65, 0, 0.35, 1)` and `--ease-spring:
cubic-bezier(0.34, 1.56, 0.64, 1)`. This phase uses fast/out for the special
variant; unrelated motion is unchanged.

The browser regression fixture at `web/tests/fibo-shape.html` uses the actual
compiled app CSS and served themes. Build the frontend, serve a dev asset root,
and open `/static/tests/fibo-shape.html`. Its result is also available as
`window.fiboShapeResults`; it throws on a failed computed-style assertion. It also
checks the Fraunces family, 600 weight and tracking on card, dialog and empty-state
headings against Basecoat, plus the explicit sans utility and UI-font key caps.
It checks grouped inputs, textareas and selects in both themes, including inside
dialogs: transparent inner controls, one focus border and raised shadow, a flat
unfocused group, and separate button outlines. Standalone fields, bare
checkboxes/radios and the code reader/editor focus treatments are covered too.

## Desktop shell and type scale

The desktop preload marks the root with `data-shell="desktop"`, `data-platform`
(`mac`, `win` or `linux`) and, where supported, `data-titlebar`. Browser tabs
leave these attributes unset. Use `desktop:` for shared shell layout and
`win-linux:` for the application-menu button; do not create another stylesheet.
Titlebar height and native window-control insets use `--titlebar-h`,
`--titlebar-left` and `--titlebar-right`. The workbench has a draggable empty strip;
interactive controls and overlays opt out of dragging.

### Keyboard shortcuts

Use the shared `Kbd` from `web/src/lib/shortcuts.tsx` for shortcut hints, one key
per Basecoat `.kbd` cap in an `inline-flex gap-1` row. `ButtonKbd` delegates to
that component with its button variant, keeping shortcut caps hidden from the
action's accessible name. Normal caps are 22px tall, single glyphs are square,
and button caps are 20px. Shared styling lives in the fibo components layer:
`radius-sm`, 12px medium text, neutral `--hover` fill and `--muted-foreground`
text. Button caps inherit the action colour with a 15% tint.

Keep Basecoat's UI font (`--ui`) on `.kbd`, never set its font to `--mono`.
Figtree's Latin range falls back to the system UI font for modifier glyphs
`⌘`, `⌃`, `⌥`, `⇧` and `↩`. Each exposed glyph cap has its readable key name
as an accessible label and title. Plain-text `keyLabel` and `withKeys` remain
for titles, tooltips and strings.

Inside a menu item, pass `menu` to `Kbd`. Its `[data-shortcut]` wrapper takes
Basecoat's automatic right alignment and leading spacing; the caps themselves
keep normal padding and zero margin, including the last cap.

### Bundled fonts

`--ui` is `"Figtree", system-ui, sans-serif`; `--mono` is `"JetBrains Mono",
ui-monospace, monospace`; `--font-display` is `"Fraunces", Georgia, serif`.
Tailwind exposes these as `font-sans`, `font-mono` and `font-display`.

The exact dev dependencies `@fontsource-variable/figtree`,
`@fontsource-variable/fraunces` and `@fontsource-variable/jetbrains-mono` are
pinned to 5.3.0. `scripts/build-web.js` copies their Latin variable WOFF2 files to
`web/dist/fonts/`: normal and italic Figtree and JetBrains Mono, and normal
weight-only Fraunces. Fraunces keeps the package's default optical-size,
softness and wonk instances. No custom axes are set. Other scripts fall back to
the system families. The build also copies the packages' OFL licenses to
`web/dist/font-licenses/`. Both directories are gitignored build output and
ship through Go's embed of `web/dist`.

The handwritten `@font-face` rules in `web/tailwind.css` use the packages' weight
ranges and Latin `unicode-range`, with `font-display: swap`. They reference
`fonts/<file>.woff2` relative to `/static/app.css`, so the static handler serves
`/static/fonts/<file>.woff2`. The launcher and holding page use the same asset
handler. Each page's `<base>` preserves its configured URL prefix. The app
preloads normal Figtree and JetBrains Mono; the launcher and holding page preload
normal Figtree. All fonts load from the app under `font-src 'self'`, including
offline desktop use. No package CSS or remote font stylesheet is imported.

Inside the fibo components layer, the rule
`:is(.card > header, .dialog > * > header, .empty > header) > :is(h2, h3)`
selects Fraunces at weight 600 with `-0.01em` tracking. The same declaration
also matches Basecoat's card-title aliases to beat its medium-weight selector.
It follows Basecoat,
so it overrides its heading defaults while explicit utilities can still win.
Nested settings titles, review section headings, the holding title and large
review empty-state headings opt in with `font-display`. Welcome and launcher
title containers use the typed brand lockup described below.
Panel labels, tabs, tree rows, toolbars, code and Markdown prose retain their
text or code family.

`editor.fontFamily` defaults to the empty string, selecting bundled JetBrains
Mono. A nonempty setting overrides source rows and edit-mode text/gutters through
`--editor-font-family`, and is passed directly to `EditorMeasure`. It does not
replace `--mono` for diffs, inline code notes, Markdown, paths or commands.
Clearing the setting restores `var(--mono)`. `EditorMeasure` measures after
`document.fonts.ready` and every `loadingdone` event, and removes the listener
on cleanup so delayed font swaps cannot leave stale column widths.

The large Memory and CPU values in the metrics popover use bundled JetBrains
Mono with tabular digits. Their labels retain Figtree.

### Type roles

Roles map onto the existing compact size scale and Basecoat defaults. There is
no second token scale: this phase preserves all sizes, line heights and the
desktop mappings. The design reference values below describe the roles; they
do not resize existing controls.

| Role | Design reference (size / line height, weight, tracking) | Existing app mapping |
| --- | --- | --- |
| `display` | 56 / 60 px, 600, -0.02em | Fraunces for Welcome and large empty-state titles; existing sizes, at most one such title per view |
| `title` | 28 / 34 px, 600, -0.01em | Fraunces for page, card and dialog titles; Basecoat title size or existing utility |
| `heading` | 20 / 26 px, 600, normal | Fraunces for review section headings; existing `text-sm` / `text-base` sizes |
| `body` | 15 / 24 px, 400, normal | Figtree for descriptions and chat; existing `text-sm`, `text-13`, `text-14`, `text-15` and prose leading |
| `label` | 13 / 18 px, 600, normal | Figtree for Basecoat controls, chips, tabs and labels; existing control sizes and weights |
| `caption` | 12 / 16 px, 500, normal | Figtree for timestamps and counts in muted ink; existing `text-xs` / `text-12` |
| `code` | 13 / 20 px, 400, normal | JetBrains Mono through `font-mono` / `var(--mono)`; editor `--fs` / `--lh` and existing compact code sizes |

`:root[data-shell]` keeps these font families and maps the `--t-*` scale to
11, 12, 13, 14, 16 and 20 px.

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

## Brand assets

`web/src/brand/Mark.tsx` renders the exact path and viewBox from
`web/mark.svg`, imported from the supplied `fibo-mark.svg`. The line uses
`currentColor` with `text-[var(--spiral)]`, so built-in and user themes supply
its colour through `--spiral`. It has one path, a 7.5-unit stroke and round
caps and joins. Width defaults to 22px. A `label` gives it `role="img"` and
an accessible name; without a label it is decorative. The only supported
`state` is `static`, also exposed as `data-state`; this brand asset does not animate.

`web/src/brand/Spiral.tsx` is the live agent status mark used only in the
threads panel, separate from the logo. Its generated line uses the same geometry for every state, with viewBox
`-40 -44 104 78`, width 22px by default, and stroke width 11 at sizes up to
32px or 7.5 above. A label supplies `role="img"`; otherwise it is decorative.

| State | Use | Motion |
| --- | --- | --- |
| `static` | Rest shape available to status consumers | None |
| `thinking` | Running thread rows, steps and artifact cards in the threads panel | Line wriggles, with a 2200ms shimmy |
| `hold` | Agent waiting for reader approval or an answer | Loose curl, 1700ms tip wag |
| `error` | Failed-thread marks in the threads panel | Springs open, rattles and curls back once over 2800ms |

There is currently no agent approval/question surface, so `hold` is available
and tested without a product placement. Finished replies gain no new marks.
The lockup continues to use `Mark`, preserving the exact logo path.

One shared requestAnimationFrame loop drives visible live spirals. Sampled
geometry and the rest path are cached. IntersectionObserver pauses offscreen
marks; disconnected marks and unmounted components leave the loop. Error
motion stops after one cycle and rests in `--danger`. Only the line moves;
the SVG never rotates, scales or slides. Under reduced motion all four states
show the static line, while labels and error colour remain. Changes to the
system preference take effect immediately.

Only the threads panel uses the animated spiral. Other AI busy states use
the rotating `ph--spinner` starburst with `motion-safe:animate-spin`, retaining
the idle icon's colour and size. This includes review stages, Explain PR,
merge-message rewriting and the explanation pill. The review Walkthrough
loading state also uses the rotating starburst. The completed explanation
pill keeps a static starburst; failure uses `ph--warning-circle` in
`text-destructive` with the accessible name "Failed". Settings saves, LSP work,
CI checks, workspace startup and refreshes keep their generic loaders.
Legacy themes fall back from `--danger` to `--destructive`.

`web/src/brand/Brand.tsx` pairs that mark with lowercase text in Fraunces at
weight 600. The wrapper supplies the single accessible name, "fibo"; its SVG
and typed text are hidden from assistive technology to avoid repetition.
The chrome lockup uses an 18px-wide mark, a `text-15` name (15px in the browser,
16px in the desktop shell), 20px line height and an 8px gap, matching the
compact Spiral preview. Welcome uses a 56px mark, a 56px name with 60px line
height, -0.03em tracking and a 16px gap. This uses the Spiral preview's large
mark size and scales the Cover preview's 120px display name down to the
56px display role. Both use centred alignment. Welcome retains its adjacent
version; the tree toolbar retains its version button and desktop drag region.
The launcher and holding page retain their surrounding header spacing.

`web/favicon.svg` is the supplied `fibo-app-icon.svg`, unchanged: a 100-unit
pale green tile with 24-unit corners and an ink spiral. It is also the source
of all three desktop icons. `web/mark.svg` is the bare spiral used by the
README image; the README prose and runtime identifiers are unchanged here.

The desktop PNG is 1024×1024, 8-bit RGBA. The previous tile reached all four
canvas edges, with transparency only at its rounded corners, so the new tile
also uses the full canvas without an additional Dock inset. The ICNS retains
the standard 16, 32, 128, 256 and 512px slots at 1× and 2×. The ICO contains
16, 24, 32, 48, 64, 128 and 256px images at 32 bits per pixel, including the
previous 128px slot as well as the six required sizes.

Regenerate from the repository root with local `rsvg-convert`, ImageMagick
and `iconutil`. Only the generated icons are stored, not a generator script:

```sh
rsvg-convert -w 1024 -h 1024 web/favicon.svg -o desktop/icons/icon.png
frames=$(mktemp -d /tmp/fibo-frames.XXXXXX)
for size in 16 24 32 48 64 128 256; do
  magick desktop/icons/icon.png -resize "${size}x${size}" "PNG32:$frames/$size.png"
done
magick "$frames/16.png" "$frames/24.png" "$frames/32.png" "$frames/48.png" "$frames/64.png" "$frames/128.png" "$frames/256.png" desktop/icons/icon.ico
iconset=$(mktemp -d /tmp/fibo-icon.XXXXXX)/icon.iconset
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  magick desktop/icons/icon.png -resize "${size}x${size}" "PNG32:$iconset/icon_${size}x${size}.png"
  double=$((size * 2))
  magick desktop/icons/icon.png -resize "${double}x${double}" "PNG32:$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o desktop/icons/icon.icns
```

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

