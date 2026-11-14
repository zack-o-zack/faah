# Bun backend

Phase 2 preserves the Go HTTP/SSE transport and frontend. Bun owns the process
envelope, assets, settings, metrics, workbench and workspace navigation. Each workspace starts a hidden
Go server for the remaining routes. `FAAH_LEGACY_BIN` must name that executable.
Auto-update and telemetry flags are accepted; Bun does not implement those
services until phase 8. The ACP stdio bridge also delegates to Go during the port.

## Module map

| Module                        | Responsibility                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `backend/src/main.ts`, `cli/` | Go-style flags, targets, ready protocol, browser, stdin and signal lifetime              |
| `http/`                       | Bun listener, HTTP adapter, guards, assets, gzip, CSP, ranges, SSE and streaming proxy   |
| `workbench/`                  | Recents, pins, stable IDs, clone discovery/preparation, children, holding pages, routes  |
| `settings/`                   | Schema/defaults, raw JSON, aliases and atomic temp/rename saves                          |
| `metrics/`                    | Own process APIs, child RSS, CPU samples at least 200 ms apart, workbench aggregation    |
| `store/db.ts`                 | SQLite WAL, foreign keys, busy timeout, versioned transactional migrations               |
| `ignore/`                     | Hierarchical Go ignore rules, scoped negation and segment/path/suffix fast paths         |
| `index/`                      | Concurrent walk, early root publication, tree/compact/touch, Git overlays and navigation |
| `fuzzy/`                      | Go scoring and UTF-8 byte positions, top-K heaps, persistent sharded Workers at 4K files |
| `search/`                     | Embedded ripgrep, indexed file batches, ASCII folding, RE2 compatibility and snippets    |
| `symbols/`                    | Go language families, declaration recognition and outline rules                          |
| `files/`                      | Lexical path resolution, raw bytes and attachment/image headers                          |
| `legacy/`                     | Go startup/stop, remaining routes, metadata/LSP adapters and migration consistency       |
| `bench/`                      | Owned HTTP measurements, Go microbenchmark vectors, rg strategies and differential QA    |
| `scripts/build.ts`            | Generate static file imports and compile the executable                                  |
| `test/`                       | Unit, two-process SQLite and streaming proxy tests                                       |
| `spike/`                      | Separate compiled runtime proof; excluded from the application                           |

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
`/api/metrics`, `/api/meta`, `/api/tree`, `/api/find`, `/api/search`,
`/api/outline`, `/api/def`, `/api/raw`, `/api/reindex`, all `/api/wb/*` and
`/w/<id>/*` routing. The last forwards to a
Bun workspace, which forwards unported routes to its hidden Go child. Host and
Origin survive both hops; response bodies stream with cancellation and no SSE
buffering. Active streams prevent idle eviction. Children use the same feature
flags, ready protocol and stdin lifetime as Go.

`backend/src/legacy/routes.ts` lists every remaining Go route explicitly:
file/save/new/close, markdown/table, session, Git/diff/gutter/history, workspace
streams, LSP, agents, threads, Explain, MCP, PR/forge and review workflow. Remove each entry when its service moves to
Bun. Metrics include the legacy process's RSS and its reported LSP memory.

## Navigation and migration consistency

The walker creates the flat file set and tree together. It uses asynchronous
filesystem operations with at most four directory jobs per CPU. Symlinks are
skipped; ignored entries remain dimmed in tree listings with size zero and are
never descended into or searched. Expanding an ignored folder reads one level
from disk, without adding it to the index. Compact views carry the deepest
folder's flags. TouchPath follows the Go insertion/deletion behavior and updates
persistent fuzzy shards after a flat-list change. Git overlays and rebuild
publication are serialized; stream updates received during a walk supersede its
older Git snapshot.

Fuzzy matching caches original/lowercase UTF-8 bytes. At 4,000 files it creates
up to four persistent Workers with disjoint copies of the paths. Build/update
messages install the paths once; queries and top-K results cross thereafter.
Each shard uses Go's worst-first heap; the parent merges by score then UTF-8 path.

Search uses a single ripgrep walk for at least 4,000 eligible files from a full
index walk, pruning known ignored paths and ineligible indexed sizes, then
filtering every hit against the exact indexed set. Small scopes,
explicit ignored-file targets and files inserted/updated by TouchPath use explicit
paths in batches below 128 KB, with up to four concurrent processes. That fallback
also preserves files reached through symlinks by TouchPath. Both strategies apply our
ignore compiler for glob filtering and the Go literal unindexed-file exception.
Literal folding uses ASCII classes; regex folding uses Unicode `(?i)`, with Go's
ASCII Perl classes and word boundaries. The adapter preserves byte-based ranges,
rune-based snippets, line anchors, empty matches and final empty lines. Files
with a NUL in their first 8,000 bytes are skipped. The 8 MiB filter uses the
indexed size, matching Go. Request cancellation kills the processes. Complete
files acquire the 200-file cap; a 50-match file cap does not mark truncation.
Over 200 matching files, Go's racing workers make selection and truncation
nondeterministic, so exact response parity is only asserted through that boundary.

All temporary consistency code lives in `legacy/` for removal in phase 8:

- Index builds fetch legacy `/api/git/refresh` after its index is ready. One
  reconnecting `/api/git/stream` subscription applies every `git-status` event.
- Proxied Git mutations apply a returned GitStatusPayload, or fetch a refresh,
  before returning to the client. Hunk, pull, sync-agent and abort also rebuild
  the index because they can change files, including on failed operations.
- Successful file save/new calls normalize the request path, TouchPath it, and
  refresh Git before returning. Agent edit/batch/job/cancel, thread
  send/cancel/revert, and review-workflow run/status/stop rebuild and refresh.
  Review-workflow config POST touches `.faah/workflows.json` and refreshes Git;
  its GET remains a read.
  After these asynchronous writers are used, later Git events rebuild too.
- Metadata always obtains current unported capabilities through one legacy
  adapter; Bun supplies index/root/version/base/workbench/Git fields and process
  metrics. `/api/reindex` rebuilds both processes.
- PR URL workspaces proxy every route to Go until phase 5. Absolute outline
  targets use the legacy LSP allowlist adapter until phase 6; relative outlines
  and definition fallback search/classification are Bun-owned. Definition LSP
  state uses an inert filename with the query's extension, preserving Go State's
  extension-only lookup even when the original path is outside the workspace.

## Phase 2 measurement commands

Results go outside the repository; do not update `bench/results/` or goldens.
Run performance commands sequentially on an otherwise quiet machine.

```sh
bun bench/corpus.ts
bun backend/bench/rg-strategies.ts                 # /tmp/faah-phase2-rg-strategies.json
bun backend/bench/micro.ts                         # /tmp/faah-phase2-micro.json
FAAH_LEGACY_BIN=/absolute/faah-go FAAH_BIN=/absolute/faah-bun bun backend/bench/differential.ts
bun bench/run.ts --bin /absolute/faah-go --label Go --repos flask,kubernetes --out /tmp/faah-phase2-go.json
FAAH_LEGACY_BIN=/absolute/faah-go bun bench/run.ts --bin /absolute/faah-bun --label Bun --repos flask,kubernetes --out /tmp/faah-phase2-bun.json
bun backend/bench/http.ts --raw-only --bin /absolute/faah-go --label Go --repos flask,kubernetes --out /tmp/faah-phase2-go-raw.json
FAAH_LEGACY_BIN=/absolute/faah-go bun backend/bench/http.ts --raw-only --bin /absolute/faah-bun --label Bun --repos flask,kubernetes --out /tmp/faah-phase2-bun-raw.json
```

The optional owned HTTP harness reuses the pinned corpus, APFS copies, scenario selection,
ready polling, latency measurements and responsiveness load from `bench/`. It
uses five fresh startup launches, five warmups, thirty measured requests, a
byte-verified raw request and a ten-second four-search/one-meta load. It excludes
unported routes and RSS, since two processes are still running. The microbench
uses all thirteen fuzzy/ignore/symbols Go Benchmark vectors, three timed samples,
and fresh outline file reads. Large fuzzy cases include persistent Worker RPC;
set-up and shard installation are outside the timed loop.
The shared harness provides the main comparison; `--raw-only` measures raw bytes
without repeating its startup and load scenarios. The rg strategy comparison
checks the base and 200-file-cap contract fixtures plus all four pinned corpora,
then alternates explicit/walking measurements after two warmups per strategy.

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

## Phase 2 verification

The compiled binary passes all 257 contracts in three consecutive runs; the Go
reference also passes 257. The backend suite has 34 tests, including every Go
ignore fast-path vector and the fuzzy/symbols unit vectors. An additional 80-case
Go/Bun differential check covers regex line anchors, zero-width Unicode matches,
Perl/POSIX classes, literal class punctuation, quoting, error responses, newlines
and raw file/directory responses. It also covers octal and hex escapes, duplicate
capture names, malformed and nested repetitions, class ranges, and definition
LSP-state lookup for parent-relative and absolute paths. Mismatches fail the
command and are written to `/tmp/faah-phase2-differential.json` for inspection.
Outlining a directory returns an empty symbol list, matching Go's ignored
scanner read error.
Symbol declarations, outline patterns and
extension families are copied exactly from the Go tables.

The root frontend check, strict backend typecheck and Prettier check pass.
AIslop reports zero new findings with no baseline changes. Source under Go,
`web/`, `desktop/`, contract goldens and `bench/results/` is unchanged. Benchmark
numbers remain external artifacts, since this is an early signal during the
migration rather than a new baseline.
