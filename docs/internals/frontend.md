# Frontend implementation

The frontend uses Solid 1.9, Vite and Vitest. Go embeds `web/dist` and serves
`static/app.js`, `static/workbench.js`, `static/holding.js`, and `static/app.css`.
Each script is a self-contained, minified IIFE targeting ES2022: no vendor chunks
or runtime package dependencies. Install with `npm ci`; run `npm run build`
before compiling Go. `npm test` runs Vitest in jsdom. `npm run lint` checks
JavaScript, TypeScript and Solid reactivity rules. `npm run typecheck` runs the
native TypeScript 7 `tsc`. `npm run format` formats the frontend and its
build/config files with Prettier. `npm run check` checks formatting, runs ESLint,
the type check and Vitest, then builds all three entries and Tailwind CSS. Use
Node 22.22.2+, 24.15.0+, or 26+ as required by jsdom. npm owns
package-lock.json; refresh the tracked pnpm lock with
`pnpm install --lockfile-only --ignore-scripts` too.

## Performance notes

The browser and desktop app use system UI and monospace fonts by default, with
no bundled font files or font requests. `editor.fontFamily` can select another
installed font. The editor measures character width at runtime because system
font metrics vary by platform.

These historical measurements were taken on an Apple M4 with Chrome 157 before
the switch to system fonts, using the then-bundled editor font:

- Entering edit mode on a 50,000-line file takes about 549 ms. Profiling attributed
  roughly 438 ms to laying out the full native textarea. The gutter is virtualized;
  the native editing surface is not. Incremental line starts reduce input CPU work.
- Workspace search takes about 892 ms, including a 160 ms input debounce. A profiled
  request spent about 681 ms awaiting the server, which opens and reads candidate
  files.
- Cold retained JavaScript heap is about 3.4 MB with inspector instrumentation,
  mostly compiled code and the reactive/component graph. Opening and closing 20
  tabs retained about 552 KB after GC, with no net DOM-node growth. Code warming
  contributes to that difference; stable DOM counts alone do not prove leak freedom.

## Pages and mount points

Each page is a mount point plus stylesheets; JSX renders everything
visible.

- `web/index.html` → `src/main.tsx`: the code reader. Renders into `#root`.
- `web/workbench.html` → `src/workbench/main.tsx`: the workbench a bare `faah` opens.
- The holding page (served by `workbench.go`) → `src/holding/main.tsx`. Go passes
  escaped JSON in the mount point's `data-page` attribute and keeps routing and the
  no-JavaScript refresh tag.

`index.html` keeps `right-hidden threads-hidden` on `<body>` so the first paint
matches the default layout before the app's body-class effect runs.

## Directory map

Under `web/src`:

| Directory | Owns |
|---|---|
| `app/` | Composition: `App.tsx` (editor store, page-wide effects, dialogs), `AppShell.tsx` (page layout and top bar), `Welcome.tsx` (empty editor), `boot.ts` (workspace start-up), `store.ts` (app store), `context.tsx`, `types.ts` (workspace metadata) |
| `editor/` | Documents, buffers, the virtualized source view, editing, find, hover, selection, Vim, tabs and the editor store that composes every slice |
| `viewers/` | Markdown/table preview, image, diff and Mermaid views, the explanation orb, and viewer actions |
| `workspace/` | File tree model and store, workspace snapshots, the event stream, new items |
| `git/` | Commit and sync, unpushed commits, per-document gutters and diff tabs |
| `review/` | The review overview: walkthrough, pipeline stages, follow-ups |
| `pr/` | Pull request bar, comments, composers, review submission, merge and forge connect |
| `agents/`, `threads/` | Agent sessions and jobs; agent threads and their transcript |
| `inspector/`, `lsp/`, `search/` | Right-sidebar panes and the language-server state they share |
| `palette/` | Command, file, symbol, line and theme palette; the command registry |
| `settings/` | Settings store, preferences derived from it, and the settings dialog |
| `shortcuts/` | App-wide key bindings, the shortcut help registry and help sheet |
| `layout/`, `status/` | Sidebars, panel handles, persisted layout; the status bar |
| `lib/` | Requests, keyboard, clipboard, theme, toasts, events and shared UI primitives |
| `workbench/`, `holding/` | The other two pages |

Pure parsing, formatting, ranking, keymaps, layout math and request shaping live
in `logic` modules (`*/logic.ts`, `settings/logic.ts`, `editor/cursor.ts` and
similar) with no DOM or Solid imports, and have unit tests. Components take
props and read shared state from context, never another component's DOM.
Dependencies point one way: components → store actions → pure logic.

## Store slices and owners

`createAppStore()` (`app/store.ts`) is created by `AppProvider`. Its state slices:

| Slice | Owner | Holds |
|---|---|---|
| `layout` | `layout/actions.ts` | Sidebar, inspector and threads visibility and widths, persisted in `faah.layout` |
| `workspace` | `workspace/actions.ts` | `/api/meta` metadata, metrics, refresh/reindex pending and error, connection state, status note |
| `documents` | `editor/documents.ts` | Open tabs, active tab and history; buffers live outside the store with revision signals |
| `editor` | `app/store.ts` | Measured character width and line height |
| `navigation` | `app/store.ts` | Word under the caret, link target, occurrence and reference highlights |
| `lsp` | `app/store.ts`, `lsp/store.ts` | Language server state for the active file |
| `git` | `workspace/actions.ts` | The latest Git snapshot, its revision, unpushed count |
| `viewers`, `explanation` | `viewers/actions.ts` | Viewed flags; the explanation orb model |

`app.settings` is the settings store (`settings/store.ts`): schema, values,
edits, the save state and the dialog. `preferences()` derives every editor
preference from the values, so the editor, documents and theme read settings
instead of keeping their own copies.

`createEditorStore()` (`editor/store.ts`) is created by `App` and composes the
editor UI state (`ui`, `geometry`) with these stores, each created by its own
factory: `agents`, `threads`, `review`, `pr`, `merge`, `forge`, `tree`, `git`,
`search`, `palette`, `language`, `shortcuts`. Each has an explicit TypeScript
`initialState()` and named actions, and owns its requests, cancellation and
pending/error state.

## Action surface

Components invoke one flat `editor.actions` object. It merges the app store's
actions with every editor slice's actions; names are unique. Composition does
not move logic: each factory keeps its own implementation. Components read app
state through `editor.store.state` and slice state through `editor.<slice>.state`.

`editor.services` holds only narrow imperative handles that a mounted component
registers for its own DOM and releases on cleanup:

- `source`: scroll, focus, native selection and caret point of the source view (`Viewport`).
- `edit`: focus, selection and scroll of the edit textarea (`EditView`).
- `find`: focus of the find input (`FindBar`).
- `preview`: line, anchor, find marks, selection and keys of the rendered preview (`PreviewContent`).
- `diff`: line scroll and hunk stepping of the diff view (`DiffViewer`).
- `imageKey`: keyboard zoom and pan of the image view (`ImageViewer`).
- `diagramFullscreens`: exits for full-screen Mermaid diagrams (`MermaidDiagram`).

No handle returns an element. Durable state, loading, errors and navigation
intent belong to stores and must not depend on whether a handle is registered.
`editor.handlers` holds the four selection actions owned by other features
(thread, agent edit, explain, review comment).

## Start-up

`main.tsx` renders `AppProvider` → the settings-driven `ThemeProvider` → `App`.
`App` creates the editor store and provides it. Its root component:

- applies body classes from layout, review mode, editor mode and preferences in one effect;
- sets the document title from the workspace name;
- calls `bootWorkspace` on mount and stops it on cleanup;
- owns the unsaved-changes `beforeunload` listener;
- renders `AppShell` and the dialogs, palette, toasts and docks.

`bootWorkspace` (`app/boot.ts`) loads settings and `/api/meta`, initializes
threads, Git, agents and the pull request, loads the tree and starts the event
stream. It then chooses the first view: Git view with the first changed file
when there are changes, the file tree otherwise, the file named by
`?path=&line=` when present, and the review overview for a PR session. While the
background indexer is still running it polls `/api/meta` one request at a time
and repeats the choice when indexing finishes. A failed metadata request is
reported on `workspace.error`.

## Event stream

`workspace/stream.ts` owns the page's one `EventSource` (`/api/stream`) through
`createEventStream`. `workspace/actions.ts` starts it and consumes `git-status`
and `metrics`. Features subscribe with `createWorkspaceSubscription(app, name,
listener)`, which releases on cleanup:

- `threads/store.ts`: `threads:list`, `threads:summary`, `threads:deleted`, and
  `thread:*` events for watched threads.
- `review/store.ts`: `review:*` pipeline events.

Topics are opt-in: `setWorkspaceTopic('threads' | 'review', on)` and
`watchWorkspaceThread(id)` (reference counted) change the stream's query, and
changes are coalesced into one reconnect. Native reconnect stays on; focus,
visibility and a stale-traffic watchdog reconnect and refresh. New consumers
read store state rather than subscribing to events.

## Shortcuts and commands

`createShortcut(combo, action, options)` (`lib/shortcuts.tsx`) binds a key inside
its component's owner and releases it on cleanup. Fields are excluded unless
`inputs` is set; `when(event)` guards the binding. `matchesShortcut` requires an
exact modifier match. Show keys with `<Kbd combo="Mod+P" />`.

- `shortcuts/GlobalShortcuts.tsx`: app-wide keys (settings, palette, inspector,
  diff, preview, sidebar, help, Escape and the `[c ]c [f ]f` chords).
- `editor/EditorShortcuts.tsx`: editor keys and Vim, inactive inside dialogs.
- Feature components bind their own keys (palette, review toggle, agent sessions,
  settings dialog).

The help sheet lists what is registered, not a separate table. Each binding
owner calls `editor.shortcuts.describe(entries)` with its help entries
(`shortcuts/help.ts` holds the editor, palette, review and agent lists) and
releases them on cleanup. `HelpSheet` groups the registry's entries by section.

Palette commands come from `palette/commands.ts`, a per-app registry. Features
register their commands with cleanup; `palette/features.ts` registers the
editor, file, copy, settings, threads, theme and Vim commands.

## Editor and viewers

`editor/buffer.ts` owns per-document HTML, loaded chunks, cancellable requests,
measured heights, layout offsets and editable text, outside store proxies, with
revision signals. The `find`, `edit`, `hover`, `selection` and `vim` action
modules own request lifetimes and state transitions; pure `layout`, `cursor`,
`find`, `edit`, `selection`, `hover` and `vim` modules hold the calculations.

`Viewport` renders `Index` slots with one scroll/resize update per frame and a
resource for the visible windows. `EditorRow` decorates rows with the CSS
Highlight API without rewriting source HTML. `EditView` keeps its gutter
virtualized. `source-dom.ts` holds DOM position adapters that the source and
diff views create over their own elements.

Documents own the chosen view (source, preview, diff), diff layout, ref and
scope, scroll targets and image state; capabilities derive from the path,
language and Git metadata. Viewer resources are keyed by path, buffer identity,
revision and diff ref, abort replaced requests and show loading, error and retry
states in JSX. Large diff hunks reuse bounded `Index` slots.

## Rules

Markup lives in JSX. No string-built HTML. Basecoat stays CSS only: never load
its JavaScript. Use Select, DropdownMenu, ContextMenu, Popover, Dialog, Tooltip,
SplitHandle and Toaster from `lib`. Native select and dialog semantics provide
keyboard interaction and modal focus containment. `toast(kind, text, duration)`
accepts text only; zero duration persists until dismissal. Copy with
`copyText`/`copyRich` from `lib/clipboard.ts`.

`innerHTML` is allowed only for HTML the server rendered or the sanitizer
passed. Each site disables the lint rules on its line with the reason:

- `editor/EditorRow.tsx`: server-highlighted source lines.
- `editor/HoverCard.tsx`: the server-highlighted symbol signature.
- `viewers/PreviewContent.tsx`: goldmark Markdown after the allowlist sanitizer.
- `viewers/viewers.test.tsx`: a static DOM fixture for the Range contract.

`viewers/markdown-dom.ts` reads `innerHTML` to serialize already-sanitized nodes.

Delete replaced implementations outright: no fallbacks, compatibility shims or
speculative backups. Match existing names and use short comments explaining
why. Comments must not name tools or products used as inspiration.

## Readability and automated checks

Use one statement per line. Do not chain statements on one line or nest
ternaries; use a small named function or `<Switch>/<Match>`. Keep components
small, with one responsibility. When a component grows past about 30 lines,
give it its own file and extract distinct views or handlers. Store factories
use a named `initialState()` and named actions, one per line.

ESLint uses `@eslint/js` recommended and the `eslint-plugin-solid` recommended
rules as errors, plus `no-nested-ternary` and `max-statements-per-line`. It also
rejects:

- async effect callbacks, destructured props, and `.map()` or `&&` in render expressions;
- `innerHTML` in JSX and HTML written with `innerHTML`, `outerHTML` or
  `insertAdjacentHTML` (`no-restricted-syntax`), except at the sites above;


Browser globals apply to frontend files, Node globals to tooling and Vitest
globals to tests. Lint errors are never disabled inline without a one-line
reason. `untrack` is reserved for deliberate mount-time injection, such as the
store instance passed to a provider. Prettier uses a 100-character print width,
single quotes, two-space indentation and semicolons, and checks every frontend file.

## TypeScript

Frontend logic and its unit tests use `.ts`; components use `.tsx`.
Imports name the real file extension (`./Foo.tsx`). The filesystem contrast and
type-scale tests use `tsconfig.node.json`, keeping Node globals out of the browser
configuration.

- Type checking is `tsc --noEmit` from TypeScript 7, the native compiler, over
  `tsconfig.json` (browser code and tests) and `tsconfig.node.json`
  (`vite.config.ts`). The build never type-checks: Vite strips types with oxc and
  `vite-plugin-solid` compiles `.tsx` JSX.
- The compiler options are strict with `noUncheckedIndexedAccess`, and output is
  erasable (`verbatimModuleSyntax`, `erasableSyntaxOnly`): no enums or
  namespaces, so stripping types is all a build does.
- typescript-eslint runs syntactic rules only (`no-explicit-any`,
  `no-non-null-assertion`, `consistent-type-imports`, `ban-ts-comment`). Its
  parser gets a pinned TypeScript 6 from `scripts/eslint-typescript`, because
  TypeScript 7 has no JS API until 7.1; `tsc` stays native.

Conventions:

- No `any`. Use `unknown` at boundaries (JSON from `/api/*`, `event.data`,
  `localStorage`) and narrow it once in a small typed parser per endpoint,
  because scattered casts hide the one place a shape can be wrong.
- A TypeScript module reads the editor composite through `useEditor()` into a
  narrow interface of what it uses (`const editor: ShellEditor = useEditor()`).
  Prefer the existing store and model types to duplicated shapes.
- No type gymnastics. Plain interfaces and type aliases, unions for states
  (`{ status: 'idle' } | { status: 'loading' } | …`), and simple generics only
  where they remove real duplication. Conditional, mapped, recursive or
  template-literal types need a one-line comment saying why.
- No `as` casts except at a parsing boundary or for a DOM ref whose element type
  is known, because a cast turns off the check it sits on. No `!` non-null
  assertions; handle the null, because the null case is usually a real state.
- Each component types its props with an interface and uses Solid's
  `Component`/`ParentComponent`/`JSX.Element`.
- Store state has an explicit interface, and actions take and return concrete types.
- Let locals infer. Annotate exported function signatures.
- Type-error suppression comments are banned.

## Solid practices

- Pass values as props; children should not need to know which values came from signals.
- Keep `props.name` reads intact; use `splitProps` or `mergeProps` to preserve getters.
- Read reactive values in JSX, functions or memos; component setup runs only once.
- Derive values instead of copying them with effects; memoize only useful shared or costly work.
- Reserve effects for the outside world; use `on` for explicit dependencies and `onMount` for setup.
- Fetch with resources or request-guarded actions; expose loading and errors and cancel stale work.
- Use stores for complex state and path setters for updates; preserve unrelated field subscriptions.
- Render with Solid control flow; use `For` for objects and `Index` for primitive or reused slots.
- Own DOM refs locally; expose narrow focus, scroll or measurement operations when needed.
- Inject stores and services through context; pass local parent-to-child data as value props.
- Keep components, named store actions and tested pure logic separate; dependencies point inward.
- Split by responsibility when it helps reading or tests; avoid abstractions added only for symmetry.

Create EventSource streams, timers, global listeners and ResizeObservers inside
components or services owned by a reactive root, and release them with
`onCleanup`. `createPolling` waits for the previous request and cancels its next
tick on disposal. `createEventStream` uses EventSource's native reconnect, drops
malformed JSON and closes on disposal.

### Effects

Every production `createEffect` touches something outside Solid:

- `app/App.tsx` (2): body classes; the document title.
- `settings/PreferenceStyles.tsx`: typography CSS variables on the document root.
- `settings/SettingCard.tsx`: scrolls to and focuses the setting the dialog opened on.
- `lib/theme.ts`: applies the resolved theme to the document root.
- `lib/Dialog.tsx`: opens and closes the native modal and restores focus.
- `lib/ToastItem.tsx`: the notification's expiry timer.
- `editor/EditorMeasure.tsx`: measures the font after type settings change.
- `editor/EditorRow.tsx` (2): ResizeObserver registration; CSS Highlight ranges.
- `editor/Viewport.tsx`: restores the native selection after slots move.
- `editor/EditView.tsx`: the textarea value and scroll when the edited document changes.
- `editor/HoverCard.tsx` (2): pointer, outside and blur listeners; card measurement and position.
- `editor/TabStrip.tsx`: focuses the tab context menu and restores focus.
- `workspace/Tree.tsx`: applies reveal intent to the native scroll.
- `search/Search.tsx`, `inspector/Symbols.tsx`: focus their input when the pane opens.
- `agents/AgentSession.tsx`: focuses and scrolls to a requested session input.
- `threads/ThreadTranscript.tsx`: keeps a followed transcript scrolled to the end.
- `review/store.ts`: subscribes the stream to the thread of the stage on screen.
- `review/WalkthroughFile.tsx`, `pr/CommentThread.tsx`: scroll to a requested file, line or thread.
- `viewers/PreviewContent.tsx`: theme picture sources and requested line or anchor scrolls.
- `viewers/MermaidDiagram.tsx`: adopts and sizes the renderer's SVG.

## Tests

Mount with a fresh store through its provider; never share stores between
tests. Assert visible behavior, keyboard interaction, focus and disposal.
Inject request and navigation functions at the store boundary, or mock
`lib/api.ts` for modules that call it directly. Vitest uses isolated VM workers. Shared setup cleans mounted
components after each test and polyfills the native dialog methods jsdom lacks.
Abridged from `settings/SettingsDialog.test.tsx`, where `reply` and `post` are
its request fixtures:

```tsx
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { SettingsProvider } from './context.ts';
import { SettingsDialog } from './SettingsDialog.tsx';
import { createSettingsStore, type SettingsStore } from './store.ts';

test('opening on a category lists its settings', async () => {
  let settings: SettingsStore | undefined;
  render(() => {
    // Created inside the render root, so its memos and cleanups belong to this mount.
    settings = createSettingsStore({ request: async () => structuredClone(reply), post });
    return (
      <SettingsProvider value={settings}>
        <SettingsDialog onVimHelp={() => {}} />
      </SettingsProvider>
    );
  });
  settings?.actions.openSettings('ui', 'Text Editor');
  fireEvent.click(await screen.findByRole('button', { name: '8' }));
  expect(screen.getByText('Modified')).toBeTruthy();
});
```

Pure modules have plain unit tests beside them. Store tests drive actions with
injected requests (`settings/store.test.ts`, `pr/test-editor.ts`). Component
examples: `lib/primitives.test.tsx`, `shortcuts/GlobalShortcuts.test.tsx`,
`workbench/Workbench.test.tsx`. `contrast.test.ts` and `typescale.test.ts`
check every theme's contrast and every used type-scale token.
