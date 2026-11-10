# Desktop runtime

`desktop/main.cjs` is an Electron main process. The renderer uses the existing
bundled UI without Node integration or a preload bridge. Context isolation,
the renderer sandbox, web security, and the backend's CSP remain enabled.
An in-memory session keeps the app separate from browser profiles. Navigation
is restricted to the exact backend origin; only HTTP(S) links without embedded
credentials can be opened externally. New embedded webviews and permissions
other than same-origin clipboard writes are denied.

`scripts/build-desktop.js` bundles the UI, compiles a static Go backend for the
selected architecture into `desktop/bin/`, and invokes electron-builder.
The app contains the executable under `Resources/bin/` (or `resources/bin/`
on Windows and Linux). Build-only dependencies stay under `desktop/` and are
not required by the CLI. App icons derive from `web/favicon.svg`.

On startup, the shell spawns the bundled executable with `-desktop-host` and
holds its stdin open. This internal flag forces the loopback host, a free port,
the root URL path, and disables browser launching and self-update. The desktop
backend bypasses the CLI's live-instance lock, but uses the same persistent
settings and workspace store. It reports `faah-desktop-ready <url>` on stdout
after installing shutdown handling, then serves the workbench.
`desktop/backend.cjs` validates this URL and supplies the window's origin.

The UI talks directly to the loopback HTTP server. This preserves the existing
REST APIs, origin verification, relative URL routing, and streaming event feeds.
Each workspace is still a child Go process behind the workbench proxy. External
content receives no desktop or filesystem bridge.

When the app quits, it closes its windows normally so `beforeunload` can protect
unsaved edits and running agents. After the windows close, the shell closes the
backend's stdin. The Go workbench stops its workspace children, drains HTTP
requests, and returns. A ten-second fallback kills a stuck backend. Shell crashes
also close the stdin pipe, initiating the same Go cleanup. On macOS, closing all
windows leaves the app and backend running until Quit.

## Verification

```bash
node scripts/build-desktop.js --backend-only
npm test --prefix desktop
npm run desktop:smoke
make check
make test
```

Desktop tests check navigation boundaries and launch the real Go backend in
isolated state/config directories. They open a workspace through the proxy,
read a live SSE stream, keep that stream open during shutdown, and verify that
stdin EOF stops the backend without modifying a separate CLI lock. Integration
coverage is skipped if the backend has not been built. Packaging CI builds it
before running these tests. The native smoke test needs a graphical desktop;
it verifies renderer isolation, opening a folder through the native menu,
external links, and cancelling and confirming Quit with unsaved work. The picker
and confirmation dialogs use controlled responses. Real folder dialogs and
clipboard actions also need testing on each target OS.
