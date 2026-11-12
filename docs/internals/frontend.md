# Frontend implementation

The frontend uses Solid 1.9, Vite and Vitest. Go embeds `web/dist` and serves
`static/app.js`, `static/workbench.js`, `static/holding.js`, and `static/app.css`.
Each script is a self-contained, minified IIFE targeting ES2022: no vendor chunks
or runtime package dependencies. Install with `npm ci`; run `npm run build`
before compiling Go. `npm test` runs Vitest in jsdom. `npm run lint` checks
JavaScript and Solid reactivity rules. `npm run format`
formats the migrated frontend and its build/config files with Prettier.
`npm run check` checks formatting, runs ESLint and Vitest, then builds all three
entries and Tailwind CSS. Use Node 22.22.2+, 24.15.0+, or
26+ as required by jsdom. npm owns package-lock.json; refresh the tracked pnpm
lock with `pnpm install --lockfile-only --ignore-scripts` too.

## Layout and rules

- `web/src/lib`: request, keyboard, lifecycle, theme, and UI primitives.
  `keyboard.js`, `toast-model.js` and page `logic.js` modules contain pure logic.
- `web/src/app`: app store factory and context. Slices cover workspace metadata,
  documents/history, editor preferences, navigation, LSP, settings, agents and Git.
- `web/src/workbench`: store/actions, provider, pure formatting/path logic,
  completion and JSX components. This is the reference for future feature work.
- `web/src/holding`: pure status interpretation and loading/error components.
  Go passes escaped JSON through the mount point's `data-page` attribute and
  retains routing and the no-JavaScript refresh tag; JSX owns visible markup.

Pure parsing, formatting, ranking, keymaps, layout math and request shaping live
in plain `.js` modules without DOM or Solid imports and receive unit tests.
Keep `.jsx` components small, with one responsibility. Components take props
and read shared state from context, never another component's DOM by id.

Create shared state with factories such as `createAppStore()` and
`createWorkbenchStore()` and provide it through context, so each test mount can
have fresh state. Local UI state uses `createSignal`; derived values use
`createMemo`, without manual synchronization. Server data uses `createResource`
or small asynchronous store actions. Updates go through named actions using
`setStore` paths, `produce`, or `reconcile`; views never mutate shared state.
Use `<Show>`, `<For>`, `<Index>`, `<Switch>` and `<Portal>` where appropriate.

Create EventSource streams, timers, global listeners and ResizeObservers inside
components or services owned by `createRoot`. Always release them with
`onCleanup`. `createPolling` waits for the previous request and cancels its next
tick on disposal. `createEventStream` uses EventSource's native reconnect, drops
malformed JSON and closes on disposal. Continue multiplexing workspace streams
on one connection as legacy stream consumers are migrated.

Markup lives in JSX. No string-built HTML. `innerHTML` is permitted only for
HTML already rendered by the server (highlighted source or goldmark markdown),
with a one-line comment identifying that source. Basecoat stays CSS only: never
load its JavaScript. Use Select, DropdownMenu, ContextMenu, Popover, Dialog,
Tooltip, SplitHandle and Toaster from `lib`. Native select and dialog semantics
provide keyboard interaction and modal focus containment. Adopt Basecoat and
Tailwind defaults; correctness takes priority over pixel parity.

Use `<Kbd combo="Mod+P" />` for labels and `createShortcut` inside the component
owner for listeners. Inputs are excluded by default; opt in deliberately.
`keyCaps` returns labels, not HTML. The theme provider owns system listeners,
resolves installed CSS themes and persists `faah.theme` and the server setting.
`toast(kind, text, duration)` accepts text only; zero duration persists until
dismissal. Tooltip takes a render function, for example
`<Tooltip text="Help">{attrs => <button {...attrs}>Info</button>}</Tooltip>`,
so its focused trigger owns the description. Tests can use `createToastStore()` with `<Toaster store={store}/>`.

Delete migrated implementations outright: no fallbacks, compatibility shims,
alternate bundlers or speculative backups. Preserve all features and shortcuts.
Match existing names and use short comments explaining why. Comments must not
name tools or products used as inspiration.

## Readability and automated checks

Use one statement per line. Do not chain several statements on one line or nest
ternaries more than one level; use a small named function or `<Switch>/<Match>`.
Keep components small and give each one responsibility. When a component grows
past about 30 lines, give it its own file and extract distinct views or handlers
as named components/functions. A page component should show its structure, not
contain a complete metrics menu or form inline. Store factories use a named,
JSDoc-typed `initialState()` function and named actions, with one action per line.
Short comments explain non-obvious constraints, not routine operations.

ESLint uses `@eslint/js` recommended and the enabled `eslint-plugin-solid`
recommended rules as errors, plus `no-nested-ternary` and
`max-statements-per-line`. Browser globals apply to frontend files, Node globals
to tooling and Vitest globals to tests. eslint-plugin-solid errors are never
disabled inline without a one-line reason. Prefer fixing reactivity in tracked
scopes; `untrack` is reserved for deliberate mount-time injection, such as the
store instance passed to a provider.

Prettier uses a 100-character print width, single quotes, two-space indentation
and semicolons. `eslint.config.js` and `.prettierignore` each contain one explicit
legacy-file list. Legacy modules leave these lists as they are migrated. New
files under the feature and library directories are checked automatically;
legacy modules are neither linted nor reformatted. The shared check command
also covers `main.jsx`, `test-setup.js`, Vite/ESLint config and web build/check
scripts.

Shared UI components each live in their own file: `Select.jsx`,
`DropdownMenu.jsx`, `ContextMenu.jsx`, `Popover.jsx`, `Dialog.jsx`, `Tooltip.jsx`
and `SplitHandle.jsx`. `menu-events.js` owns the shared roving-focus,
outside-click and Escape listeners. `ToastItem.jsx` holds the notification view;
`toast.jsx` holds the notification service and toaster.

Workbench is composed from `WorkbenchHeader`, `OpenWorkspaceForm`,
`WorkbenchTabs`, `Recent`, `RecentRow`, `Browse`, `BrowseToolbar`, `DirectoryList`,
`NewFolderForm`, `Clone`, `WorkbenchFooter`, `MetricsMenu` and `ThemeMenu`, with
one component per file. Path completion uses `PathInput` and `PathSuggestions`.

## Solid practices

- Pass values as props; children should not need to know which values came from signals.
- Keep `props.name` reads intact; use `splitProps` or `mergeProps` to preserve getters.
- Read reactive values in JSX, functions or memos; component setup runs only once.
- Derive values instead of copying them with effects; memoize only useful shared or costly work.
- Reserve effects for external APIs; use `on` for explicit dependencies and `onMount` for setup.
- Fetch with resources or request-guarded actions; expose loading and errors and cancel stale work.
- Use stores for complex state and path setters for updates; preserve unrelated field subscriptions.
- Render with Solid control flow; use `For` for objects and `Index` for primitive or reused slots.
- Own DOM refs locally; expose narrow focus, scroll or measurement operations when needed.
- Inject stores and services through context; pass local parent-to-child data as value props.
- Keep components, named store actions and tested pure logic separate; dependencies point inward.
- Split by responsibility when it helps reading or tests; avoid abstractions added only for symmetry.

ESLint also rejects async effect callbacks, direct props destructuring, and `.map()` or `&&`
render expressions. These guards supplement `eslint-plugin-solid`; they do not replace review.

## Editor core (phase A1)

`app/store.js` owns document metadata and history through `editor/documents.js`.
`editor/buffer.js` owns plain per-document HTML, loaded chunks, cancellable requests,
column widths, measured heights, layout offsets and editable text. Revision signals
publish changes without putting these large buffers in deep store proxies.

`editor/store.js` composes editor state, selectors and named actions. The `find-actions`,
`edit-actions`, `hover-actions`, `selection-actions` and `vim-actions` modules own request
lifetimes and state transitions. They use injected services, never DOM elements. Pure
`layout`, `cursor`, `find`, `edit`, `selection`, `hover` and `vim` modules contain tested
calculations. `symbols.js` guards outline and LSP symbol requests by document identity.

`EditorShell` mounts tabs, file actions, the source viewport, editing, find, hover,
selection actions, cursor status, Vim status/help and minimap. `Viewport` uses `Index`
slots and one scroll/resize update per animation frame. A resource loads its visible
windows. `EditorRow` derives decorations and uses the CSS Highlight API without
rewriting source HTML. `EditView` keeps its gutter virtualized instead of creating
50,000 line-number elements and measuring a full mirror on every input.

Components own their refs. `source-dom.js` holds DOM-only position adapters instantiated
by the viewport (and the temporary bridge); it is not a pure logic module. Components
register narrow view operations such as focus, scroll, selection and coordinates in the
injected services. No view operation returns an element. Parent-to-child measurement
callbacks stay in props; reactive data props are passed as values.

## Temporary main-app bridge

`main.jsx` mounts providers, `EditorShell`, `ViewerShell` and the toaster, then starts `initLegacy()`.
Only `app/legacy-bridge.js` adapts migrated APIs for legacy consumers. It carries the
removal marker and replaces the previous theme bridge. Its adapters cover:

- `S.tabs`, active tab, history, workspace metadata, editor preferences, cursor/navigation
  and LSP state. Legacy metadata field writes enter named store actions.
- Legacy document facades over metadata and plain buffers, with Git gutter data outside
  proxies and guards against writing through a disposed or replaced document. Viewer
  HTML, parsed tables, diff rows and full-file expansion buffers belong to mounted resources.
- File open/switch/close/reopen, history, line jumps, layout notifications, find,
  selection, hover, edit and Vim actions; theme observation and theme changes.
- Narrow preview navigation/find/selection, image-key and Mermaid fullscreen operations;
  diff refresh, scope, file/hunk stepping, viewed flags and layout preference.
- The stable diff root used by legacy PR comment placement, its repaint notification,
  server-Markdown sanitization for PR comments, and explain-thread events.
- Remaining source DOM handles, Git gutters, outline notifications and
  agent/thread/review/explain selection callbacks.

Remaining tree, palette, search, Git/PR/review, agent and status modules import
these APIs directly from this one bridge. `state.js` and `ui.js` do not re-export migrated
editor or viewer APIs. Markdown, Mermaid, tables, images, diffs and the explain orb
are Solid components in `viewers/`. `outline-pane.js` keeps only the existing right-pane rendering and events;
it remains in both explicit legacy lists until phase B replaces that UI. Editor-side
symbol fetching and state are already migrated. Delete the bridge, legacy boot/state
helpers and static shell when the final legacy consumer is migrated.

## Component tests

Mount with a fresh store through its provider. Assert visible behavior,
keyboard interaction, focus and disposal. Inject request/navigation functions
at the store boundary. Never share app stores between tests.

```jsx
import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { test, expect } from 'vitest';
import { createAppStore } from './store.js';
import { AppProvider, useApp } from './context.jsx';

function WrapControl() {
  const { state, actions } = useApp();
  return <button onClick={() => actions.setEditorPreference('wrap', !state.editor.wrap)}>
    {state.editor.wrap ? 'Wrap on' : 'Wrap off'}
  </button>;
}
test('toggles wrap with fresh state', async () => {
  render(() => <AppProvider store={createAppStore()}><WrapControl /></AppProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Wrap on' }));
  expect(screen.getByRole('button', { name: 'Wrap off' })).toBeTruthy();
});
```

Shared setup cleans mounted components after each test. Legacy tests with
hand-built browser objects still run under jsdom; new component tests use its
real document. See `lib/primitives.test.jsx`, `workbench/Workbench.test.jsx` and
`holding/Holding.test.jsx` for working examples.

## A1 Solid audit

Effects retained after the phase 0/A1 audit:

- `lib/theme.js`: applies the resolved theme to the document root.
- `lib/Dialog.jsx`: drives native modal open/close and restores focus.
- `lib/ToastItem.jsx`: owns notification expiry timers and cancels them on disposal.
- `app/legacy-bridge.js`: notifies imperative legacy theme consumers.
- `editor/EditorShell.jsx`: applies editor mode classes to the static document body,
  using explicit dependencies with `on`.
- `editor/EditorRow.jsx` (observer): registers each owned row with ResizeObserver.
- `editor/EditorRow.jsx` (highlights): updates CSS Highlight ranges after source or
  highlight inputs change.
- `editor/Viewport.jsx`: restores native selection after virtual slots move;
  it does not derive or update selection state in that effect.
- `editor/EditView.jsx`: updates the native textarea value and scroll when switching
  editing documents, with explicit dependencies rather than tracking input updates;
  clears the native text copy when editing ends or the tab closes.
- `editor/HoverCard.jsx` (listeners): owns pointer/outside/blur listeners and their cleanup.
- `editor/HoverCard.jsx` (position): measures the card's actual dimensions, positions
  it and handles requested keyboard focus.
- `editor/TabStrip.jsx`: focuses the native context menu and restores prior focus.

Removed or replaced effects:

- Holding derives initial progress from props; `onMount` starts one cancellable poll,
  and only poll results write progress.
- Selection status derives from `#footer-sel` through CSS `:has`, eliminating the
  class-synchronization effect. Selection actions own explanation-preparation timers.
- Vim disable/reset and prefix expiry happen in named actions with owned timers.
- A viewport resource owns chunk-window loading instead of an effect starting requests.
- Editable buffers publish their own revision; no effect increments a second revision
  to synchronize editable state.

The audit removed the controller/ref registry, moved DOM adapters into the viewport,
and separated feature actions from pure algorithms. Workbench children expose focus
operations instead of handing DOM elements to parents. Workbench refresh/open actions
also reject stale responses. Context injects stores and services, and no migrated
component receives signal accessors as data props or destructures its props.
There are twelve production `createEffect` calls in the directories above (two each
in `EditorRow` and `HoverCard`, one in each other listed module), and one test-only
effect in `lib/events.test.jsx` that observes batched stream updates. Workbench and
holding contain none. The selection bar mounts its actions only while selected;
Vim help mounts only when requested.
Components invoke named actions for find-case, selection-menu and Vim-help changes;
the shared UI setter stays in store actions and the temporary bridge.


## File viewers (phase A2)

Document entries own the chosen preview/source view, diff layout/ref/scope, collapsed
sections, scroll targets and image transform/background/pixelation state. Capabilities
derive from the path/language and Git metadata. `FileActions` renders these choices;
`viewers/actions.js` provides named transitions and the explanation store slice.

`ViewerShell` mounts `PreviewViewer`, `ImageViewer`, `DiffViewer` and `ExplainOrb`.
Markdown/table/diff resources are keyed by path, buffer identity and generation,
revision and diff ref/base. Replaced requests are aborted; Solid discards stale results.
Unrelated chunk publications do not refetch. Parsed data remains outside deep proxies
and is released with its mounted viewer. Loading, error and retry views live in JSX.

`markdown-dom.js` applies the existing inert allowlist sanitizer and serializes selections.
`PreviewContent` owns its rendered article, enhancement setup, delegated link/copy/image
handlers and narrow preview operations. `markdown-logic.js`, `markdown-picture.js` and
`view.js` contain tested URL, picture-source, capability and source-line calculations.
`MermaidDiagram` uses the theme store directly and lazily loads the existing vendor asset.
Its strict SVG output is parsed into the owned canvas. The runtime serializes renderer
calls and bounds its diagram cache to 50 entries. `TableViewer` renders text cells with
`For`/`Index`, retains the 1,000-row cap and provides source-line buttons.

`image-math.js` holds tested fit, zoom and pan calculations. `ImageViewer` owns image
loading, metadata, pointer/wheel listeners and resize observation; `ImageHUD` invokes
named document actions. `Lightbox` mounts only when a preview image is opened.

Diff parsing/serialization, split/unified rows, intraline parts, gutter/selection mapping,
context expansion and measured window calculations live in the pure `diff-*.js` modules
(except the DOM Range adapter `diff-selection.js`). `diff-actions.js` owns guarded hunk
requests and releases expanded file buffers on disposal. `DiffContent`, `DiffSection`,
`DiffStrip`, `DiffRows` and `DiffRow` own their markup. Hunks above 400 rows reuse bounded
`Index` slots with ResizeObserver measurements, preserving wrapped line heights.
Rows expose numeric line positions, never elements, for navigation. Agent highlights
derive from the shared target ranges. Legacy PR annotations still attach through the
bridge to the stable diff root until phase C.

The A2 effect audit retains three new `createEffect` calls:

- `PreviewContent`: applies app-theme picture sources and requested source-line/anchor
  scrolls to its owned rendered article.
- `MermaidDiagram`: adopts and sizes the strict vendor renderer's SVG in its owned canvas.
- `DiffContent`: schedules the legacy PR annotation repaint after layout, section or
  expanded-context DOM changes, cancelling the frame on disposal.

Other viewer setup uses owned `onMount` callbacks with cleanup for listeners, observers,
timers and registered operations. The explain orb and image controls need no effects.
No migrated component obtains another component's elements through context. A2 removes
viewer cache fields, Markdown selection/marking adapters, row/point geometry exports and
the imperative agent-diff highlight callback from the bridge. The remaining metadata and
orb sidebar observer are temporary legacy adapters confined to that file.

## Action surface

Editor and viewer components invoke the single flat `editor.actions` object. It composes
app document/history/preferences actions, viewer transitions and editor interaction
actions. Components read app state through `editor.store.state`; they do not select
between different action registries. Feature action factories still own their logic;
composition does not move their implementations into a controller. Names must be unique.

`openLink` opens a document in isolated editor mounts. The temporary bridge adapts this
action to reveal directory links through the legacy tree; there is no optional directory
hook in editor services. Owned view operations remain narrow injected services.

The A2 wrap-up memoizes sanitized content and adds no effects.

Covered source viewports derive an empty slot window while editing or displaying a
viewer. Switching back mounts source rows from the same buffer. Keeping hidden rows
mounted spends layout and reactive work on an invisible duplicate view. No effect
synchronizes this visibility; it derives from the document view mode.
