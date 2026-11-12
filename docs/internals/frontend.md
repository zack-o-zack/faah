# Frontend implementation

The frontend uses Solid 1.9, Vite and Vitest. Go embeds `web/dist` and serves
`static/app.js`, `static/workbench.js`, `static/holding.js`, and `static/app.css`.
Each script is a self-contained, minified IIFE targeting ES2022: no vendor chunks
or runtime package dependencies. Install with `npm ci`; run `npm run build`
before compiling Go. `npm test` runs Vitest in jsdom; `npm run check` runs tests
and builds all three entries and Tailwind CSS. Use Node 22.22.2+, 24.15.0+, or
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

## Temporary main-app bridge

`main.jsx` mounts providers and the Solid toaster beside the existing markup in
`index.html`, then calls `initLegacy()` from `main.js` after mounting. Remaining
legacy modules still use `S`, the bus, DOM ids and HTML strings until their phase
replaces them. Do not copy these patterns into new code. `app/theme-bridge.js`
lets legacy settings, shortcuts, palettes and markdown observe the provider's
theme. It is part of the explicitly temporary main-app bridge. Delete it,
`main.js`, legacy state helpers and static shell when the final legacy module
is migrated. The bridge is annotated at its entry points.

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
