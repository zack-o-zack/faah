# Desktop app

The desktop app runs faah in a dedicated Electron window. It does not use your
browser profile, extensions, tabs, address bar, spellchecker, or browser menus.
Your existing review UI, shortcuts, Git operations, coding agents, and live
updates run against the same Go backend as the CLI.

## Build and open

Install Go 1.25+, Node.js 22.12+, and npm. Bun is optional for faster UI bundling.

```bash
npm ci --prefix desktop
npm run desktop:package
```

Open the app under `dist/desktop/`. On Apple Silicon, it is
`dist/desktop/mac-arm64/faah.app`; on Intel Macs, `dist/desktop/mac/faah.app`.
Windows uses `win-unpacked/faah.exe`; Linux uses `linux-unpacked/faah`.
These folders contain everything needed to run the app; end users do not need
Go, Node.js, npm, or a separate faah installation. Git, coding harnesses, and
language servers must still be installed to use their respective features.

Use `npm run dev:desktop` during development. CSS changes apply in place, UI
changes reload the open windows, and changes to the Go backend or `desktop/*.cjs`
relaunch the app. It uses its own Electron profile, so it can run next to an
installed faah. `npm run desktop` builds once and opens the app without reloading.

## Window frame

macOS and Windows draw their window controls over faah's own top bar. Linux keeps
the system frame, because tiling window managers and Wayland compositors treat
custom title bars differently. On Windows and Linux a menu button in the top bar
opens the application menu. `desktop/preload.cjs` marks `<html>` with `data-shell`,
`data-platform`, and `data-titlebar`, and `web/desktop.css` is scoped to them, so a
browser tab never gets these styles.

## Use the app

- **File → Open Folder** (`Cmd/Ctrl+O`) opens a native folder picker and a new
  workspace window. Paste PR URLs into the workbench as usual.
- **File → New Workbench Window** (`Cmd/Ctrl+Shift+N`) opens another launcher.
- **View → Show Workbench** (`Cmd/Ctrl+Shift+H`) returns to a launcher in a new window.
- Links to forge pages and other external sites open in your default browser.
  Links within faah stay in the desktop app. The PR launcher may reuse its
  current window.
- Closing a workspace warns about unsaved edits or running agent work. Cancelling
  the warning keeps the window and backend running.
- On macOS, closing the last window keeps the app available in the Dock.
  **faah → Quit** (`Cmd+Q`) stops it. On Windows and Linux, closing the last window
  also quits the app.

The app shares faah's existing settings, recent workspaces, and review drafts
with the CLI. It owns a separate backend, so quitting the app does not stop an
independently launched CLI server. On macOS, it reads the login shell's `PATH`
so tools installed through Homebrew or a shell-managed toolchain can be found
when the app starts from Finder.

## Cross-platform packages

```bash
npm run desktop:dist
# Or choose a supported architecture on the current OS:
node scripts/build-desktop.js --dist --arch=arm64
```

Build on each target OS. Changing `--arch` selects both the Go backend and
Electron architecture; it does not cross-compile an entire app for another OS.
The GitHub Actions workflow builds these combinations:

| OS | Architectures | Output |
| --- | --- | --- |
| macOS | Apple Silicon, Intel | ZIP containing `faah.app` |
| Windows | x64 | NSIS installer |
| Linux | x64 | AppImage and `.deb` |

Download the artifacts from the **Desktop apps** workflow run. Packages use
the version in `VERSION`. Builds are unsigned and macOS builds are not
notarized. Signing credentials and notarization must be configured before
distributing trusted public installers. AppImage needs FUSE on some Linux
systems; the Debian package is an alternative on supported distributions.
Linux needs a graphical desktop and Chromium's system libraries.

The bundled Chromium engine makes rendering consistent across platforms and
does not depend on an installed WebView2 or WebKit runtime. It increases download
size compared with the CLI's browser mode. Windows requires its own runtime
verification; building an artifact alone does not verify all native interactions.

The backend's binary self-updater is disabled inside the desktop app because
it cannot update the surrounding application bundle. Rebuild or install a new
desktop package to update it.
