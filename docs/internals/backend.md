# Bun backend

Phase 1 preserves the Go HTTP/SSE transport and frontend. Bun owns the process
envelope, assets, settings, metrics and workbench. Each workspace starts a hidden
Go server for the remaining routes. `FAAH_LEGACY_BIN` must name that executable.
Auto-update and telemetry flags are accepted; Bun does not implement those
services until phase 8. The ACP stdio bridge also delegates to Go during the port.

## Module map

| Module                        | Responsibility                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `backend/src/main.ts`, `cli/` | Go-style flags, targets, ready protocol, browser, stdin and signal lifetime             |
| `http/`                       | Bun listener, HTTP adapter, guards, assets, gzip, CSP, ranges, SSE and streaming proxy  |
| `workbench/`                  | Recents, pins, stable IDs, clone discovery/preparation, children, holding pages, routes |
| `settings/`                   | Schema/defaults, raw JSON, aliases and atomic temp/rename saves                         |
| `metrics/`                    | Own process APIs, child RSS, CPU samples at least 200 ms apart, workbench aggregation   |
| `store/db.ts`                 | SQLite WAL, foreign keys, busy timeout, versioned transactional migrations              |
| `legacy/`                     | Go process startup/stop and explicit remaining route list                               |
| `scripts/build.ts`            | Generate static file imports and compile the executable                                 |
| `test/`                       | Unit, two-process SQLite and streaming proxy tests                                      |
| `spike/`                      | Separate compiled runtime proof; excluded from the application                          |

Services accept typed values and return plain values. HTTP modules decode
requests, call services and encode responses. Services have no Request/Response
parameters. A later WebSocket adapter can call the same services. New external
inputs must be decoded from unknown; keep TypeScript strict, with no `any`, casts
(except `as const`), non-null assertions or suppression directives. Format with
Prettier. Keep business logic out of routes.

SQLite lives at `$XDG_STATE_HOME/faah/faah.db`, otherwise `~/.faah/faah.db`.
Schema version 1 contains workbench items and clone mappings. Every connection
sets WAL, `busy_timeout=5000` and foreign keys. Mutations use immediate
transactions so workbench and workspace processes can share it. Old workbench
JSON is not imported. Settings remain at `$XDG_CONFIG_HOME/faah/settings.json`,
otherwise `~/.faah/settings.json`. CLI workbench instance locks retain their old
JSON format; desktop hosts never replace them.

## Ownership

Bun owns `/`, normalized base redirects, `/static/*`, `/api/settings`,
`/api/metrics`, all `/api/wb/*` and `/w/<id>/*` routing. The last forwards to a
Bun workspace, which forwards unported routes to its hidden Go child. Host and
Origin survive both hops; response bodies stream with cancellation and no SSE
buffering. Active streams prevent idle eviction. Children use the same feature
flags, ready protocol and stdin lifetime as Go.

`backend/src/legacy/routes.ts` lists every remaining Go route explicitly:
meta, tree/find/search/reindex, file/raw/save/new/close, markdown/table/outline/def,
session, Git/diff/gutter/history, workspace streams, LSP, agents, threads, Explain,
MCP, PR/forge and review workflow. Remove each entry when its service moves to
Bun. Metrics include the legacy process's RSS and its reported LSP memory.

## Build and validation

```sh
cd backend && bun install && cd ..
npm run build
bun run backend:build                     # backend/dist/faah
bun run backend:typecheck
bun run backend:test
FAAH_LEGACY_BIN=/absolute/faah-go backend/dist/faah -no-open -desktop-host
FAAH_BIN=/absolute/faah-bun FAAH_LEGACY_BIN=/absolute/faah-go bun test test/contract
npm run check
npm run aislop:ci
```

`FAAH_BUILD_OUT` changes the output directory; `FAAH_BUILD_NAME` changes the
filename. The build generates ignored `http/manifest.js` imports with the `file`
loader. Compiled assets include VERSION, both HTML entrypoints, dist, themes,
vendor files and logos/favicons. `FAAH_DEV_ROOT` overrides reads with disk assets.
Lazy vendor downloads use the existing pinned CDN and the Go vendor cache path.

## Compiled spike on macOS arm64

Run `bun backend/spike/build.ts && /tmp/faah-bun-spike/spike`. Its pinned packages
are Parcel watcher 2.5.6, Shiki 3.22.0 and VS Code ripgrep 1.17.0. Bun 1.4.4:

- **SQLite:** created a table, inserted and read a row inside the compiled binary.
- **Watcher:** observed a created file. Parcel's dynamic package-name loader
  failed after compilation. Directly importing the Darwin arm64 `watcher.node`
  embeds the native library and works. Other platforms need their own native import.
- **Shiki:** a Worker highlighted TypeScript with a bundled grammar, GitHub dark
  theme and JavaScript regex engine; no runtime grammar downloads or WASM files.
- **ripgrep:** embedded `rg`, extracted it to a versioned cache directory with
  executable permissions, and verified `--json` match output. The package version
  and complete dependency resolution are pinned in `backend/bun.lock`.
- **Workers:** bundled the Worker separately, embedded the bundle as a file,
  started it from that embedded path and received its highlight response.

The spike is not shipped. Unit tests and existing contracts do not cover live
private-forge clone authentication or all filesystem error diagnostics. Settings
syntax errors outside the covered truncated-input case may retain Bun wording;
static multipart ranges are not yet implemented. Treat these as remaining parity
limits, not changes to the golden contract.

## Preserved Go oddities

Reads often accept POST. Trusted workbench reads do not require Origin.
`localPost` accepts non-loopback numeric IP Hosts and ignores the Origin scheme.
Workspace stdin EOF exits 130; desktop EOF exits 0. Stopped workbench children
report an unexpected-exit error even when intentionally stopped. File save/new
skip the localPost checks. Legacy path containment follows external symlinks,
search caps can underreport truncation, and malformed CSV is accepted.

## Phase 1 verification

On this Mac: 11 unit tests pass; strict typecheck passes; all 257 existing
contracts pass against the compiled Bun binary in three consecutive runs, and
257 pass against Go. The frontend check passes. AIslop reports zero new findings
without baseline changes. A desktop-host smoke test opened a workspace and read
ready metadata through both proxy hops; stdin EOF exited 0. The compiled backend
is 90,183,650 bytes (about 86.0 MiB), including Bun and embedded frontend assets.
Go code, frontend source, desktop source and contract goldens were unchanged.
