# Phase 0 verification

Phase 0 introduces Solid foundations and migrates workbench and holding. The main workspace remains behind the documented bridge.

## Dependencies

- `solid-js`: `1.9.19`
- `vite`: `8.3.8`
- `vite-plugin-solid`: `2.11.16`
- `vitest`: `5.1.0`
- `jsdom`: `31.0.0`
- `@solidjs/testing-library`: `0.8.10`
- `@testing-library/user-event`: `14.6.10`

## Bundles

Uncompressed bytes, measured with the original Bun build before editing and the final Vite build. Each new entry includes its own runtime.

| Entry | Before | After |
| --- | ---: | ---: |
| app.js | 433,670 | 431,206 |
| workbench.js | 22,295 | 47,074 |
| holding.js | 2,749 | 16,907 |

## Verification

- `npm ci`: passed with Node 24.15.0. Clean lock generation was needed to avoid npm 11.6.2 dropping optional Rolldown dependencies when updating against an installed tree.
- `npm run build`: passed; three minified self-contained scripts and Tailwind CSS.
- `npm test`: 73 passed, one optional sibling-repository test skipped; 22 files.
- `npm run check`: passed (the same tests and all builds).
- `go build ./...`: passed.
- `go test -short ./...`: passed across all packages. An initial unrelated model-discovery timeout passed on rerun.
- `go build -o /tmp/faah-p0 . && /tmp/faah-p0 --help`: passed; flags used include `-port`, `-no-open`, `-no-update`, `-no-telemetry`, `-no-lsp`.
- Desktop asset-reload tests: three passed.
- `pnpm install --lockfile-only --ignore-scripts`: refreshed the tracked lock.

## Browser smoke

Headless installed Chrome through Playwright, using the final binary with FAAH_DEV_ROOT and current built assets. The workspace ran on 18769 and workbench on 18770, with no browser automatically opened.

- Workspace `/`: tree rendered, scripts/build-web.js opened in a file tab, theme changed, and a Solid notification appeared.
- Workbench `/`: recent items rendered, Browse displayed six folders, and choosing Paper changed the theme to light.
- Both pages: no console errors, JavaScript exceptions, or failed HTTP requests.
- Theme preview/selection, menu focus return, shortcut disposal, split limits, requests, holding errors/progress and polling disposal are covered in component/unit tests.

## Boundaries and remaining validation

No live PR clone, stop-workspace, or folder creation was performed against user data. Store/component tests exercise request shaping and clone selection. Holding loading/error states are component-tested; startup redirects retain the existing Go behavior. No claim of an exhaustive manual audit of all legacy features is made.

Go changes cover embedded/static asset paths, the holding-page data handoff, the dev-asset fixture, and the serving CSP allowance for the existing remote tips source. Initial smoke with `-no-agent` produced missing-route errors; final smoke uses normal agent routes without starting an agent.

The workspace S object, event bus and static HTML are intentionally retained only for unmigrated modules. New modules use factories, providers and owned effects. See [frontend.md](frontend.md) for the conventions and component-test template.

## File inventory

### Added

- `docs/internals/frontend.md`
- `vite.config.js`
- `web/src/app/context.jsx`
- `web/src/app/store.js`
- `web/src/app/theme-bridge.js`
- `web/src/holding/Holding.jsx`
- `web/src/holding/Holding.test.jsx`
- `web/src/holding/logic.js`
- `web/src/holding/main.jsx`
- `web/src/lib/api.js`
- `web/src/lib/api.test.js`
- `web/src/lib/components.jsx`
- `web/src/lib/events.js`
- `web/src/lib/keyboard.js`
- `web/src/lib/keyboard.test.js`
- `web/src/lib/primitives.test.jsx`
- `web/src/lib/shortcuts.jsx`
- `web/src/lib/theme-context.jsx`
- `web/src/lib/theme-preference.js`
- `web/src/lib/theme.js`
- `web/src/lib/toast-model.js`
- `web/src/lib/toast.jsx`
- `web/src/main.jsx`
- `web/src/test-setup.js`
- `web/src/workbench/PathInput.jsx`
- `web/src/workbench/Workbench.jsx`
- `web/src/workbench/Workbench.test.jsx`
- `web/src/workbench/context.jsx`
- `web/src/workbench/logic.js`
- `web/src/workbench/logic.test.js`
- `web/src/workbench/main.jsx`
- `web/src/workbench/store.js`
- `docs/internals/frontend-phase0-verification.md` (this report)

### Changed

- `.github/workflows/ci.yml`
- `.github/workflows/desktop.yml`
- `.github/workflows/nightly.yml`
- `.github/workflows/release.yml`
- `.gitignore`
- `Makefile`
- `desktop/dev-reload.cjs`
- `devassets_test.go`
- `docs/internals/architecture.md`
- `docs/internals/styling-and-themes.md`
- `package-lock.json`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/build-web.js`
- `scripts/check-web.js`
- `scripts/dev-desktop.js`
- `scripts/test-bench.sh`
- `server.go`
- `web/index.html`
- `web/src/agent-picker.test.js`
- `web/src/cardkeep.test.js`
- `web/src/contrast.test.js`
- `web/src/controls.test.js`
- `web/src/errors.test.js`
- `web/src/hover-position.test.js`
- `web/src/main.js`
- `web/src/markdown-picture.test.js`
- `web/src/markdown.js`
- `web/src/orb.test.js`
- `web/src/overlays.test.js`
- `web/src/palette.js`
- `web/src/palette.test.js`
- `web/src/reviewflow.test.js`
- `web/src/settings.js`
- `web/src/shortcuts.js`
- `web/src/state.js`
- `web/src/theme.test.js`
- `web/src/threadrefs.test.js`
- `web/src/tips.test.js`
- `web/src/toast.test.js`
- `web/src/typescale.test.js`
- `web/src/ui.js`
- `web/workbench.html`
- `workbench.go`

### Deleted

- `web/src/holding.js`
- `web/src/theme-preference.js`
- `web/src/theme.js`
- `web/src/toast.js`
- `web/src/workbench.js`
