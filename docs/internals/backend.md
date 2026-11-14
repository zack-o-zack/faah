# Bun backend

Phase 3 preserves the Go HTTP/SSE transport and frontend. Bun owns the process
envelope, assets, settings, metrics, workbench, navigation, rendering and file
operations. Each workspace starts a hidden
Go server for the remaining routes. `FAAH_LEGACY_BIN` must name that executable.
Auto-update and telemetry flags are accepted; Bun does not implement those
services until phase 8. The ACP stdio bridge also delegates to Go during the port.

## Module map

| Module                        | Responsibility                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `backend/src/main.ts`, `cli/` | Go-style flags, targets, ready protocol, browser, stdin and signal lifetime                                   |
| `http/`                       | Bun listener, HTTP adapter, guards, assets, gzip, CSP, ranges, SSE and streaming proxy                        |
| `workbench/`                  | Recents, pins, stable IDs, clone discovery/preparation, children, holding pages, routes                       |
| `settings/`                   | Schema/defaults, raw JSON, aliases and atomic temp/rename saves                                               |
| `metrics/`                    | Own process APIs, child RSS, CPU samples at least 200 ms apart, workbench aggregation                         |
| `store/db.ts`                 | SQLite WAL, foreign keys, busy timeout, versioned transactional migrations                                    |
| `ignore/`                     | Hierarchical Go ignore rules, scoped negation and segment/path/suffix fast paths                              |
| `index/`                      | Concurrent walk, early root publication, tree/compact/touch, Git overlays and navigation                      |
| `fuzzy/`                      | Go scoring and UTF-8 byte positions, top-K heaps, persistent sharded Workers at 4K files                      |
| `search/`                     | Embedded ripgrep, indexed file batches, ASCII folding, RE2 compatibility and snippets                         |
| `symbols/`                    | Go language families, declaration recognition and outline rules                                               |
| `files/`                      | File windows, raw downloads, Markdown/table file limits, save/new/close and typed request decoding            |
| `render/`                     | Shiki Workers, Chroma language names and scope classes, immutable documents, L1/L2 caches and idle scavenging |
| `markdown/`, `table/`         | Goldmark-compatible Markdown structure and Go CSV parsing                                                     |
| `watch/`                      | Native filesystem subscription, ignore filtering, debounce and Git refresh                                    |
| `legacy/`                     | Go startup/stop, remaining routes, metadata/LSP adapters and migration consistency                            |
| `bench/`                      | Owned HTTP measurements, Go microbenchmark vectors, rg strategies and differential QA                         |
| `scripts/build.ts`            | Generate static file imports and compile the executable                                                       |
| `test/`                       | Unit, two-process SQLite and streaming proxy tests                                                            |
| `spike/`                      | Separate compiled runtime proof; excluded from the application                                                |

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
`/api/outline`, `/api/def`, `/api/raw`, `/api/reindex`, `/api/file`,
`/api/markdown`, `/api/table`, `/api/file/save`, `/api/fs/new`, `/api/close`,
all `/api/wb/*` and
`/w/<id>/*` routing. The last forwards to a
Bun workspace, which forwards unported routes to its hidden Go child. Host and
Origin survive both hops; response bodies stream with cancellation and no SSE
buffering. Active streams prevent idle eviction. Children use the same feature
flags, ready protocol and stdin lifetime as Go.

`backend/src/legacy/routes.ts` lists every remaining Go route explicitly:
session, Git/diff/gutter/history, workspace
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

Fuzzy matching caches original/lowercase UTF-8 bytes and path penalties. Scoring
does not allocate positions for rejected candidates. At 4,000 files it creates
up to four persistent Workers with disjoint copies of the paths. Build/update
messages install the paths once; queries and top-K results cross thereafter.
Each shard uses Go's worst-first heap and transfers packed IDs/scores; the parent
merges by score then cached UTF-8 path bytes and computes positions for the final
winners. In-flight queries retain their installed snapshot during index updates.

Search uses one ripgrep process with up to four walking threads for at least
4,000 eligible files from a full
index walk, pruning known ignored paths and ineligible indexed sizes, then
filtering every hit against the exact indexed set. Small scopes,
explicit ignored-file targets and new TouchPath entries use explicit paths in
batches below 128 KB, with up to four concurrent processes. Updates to previously
walked regular files retain the parallel walker after checking the file and its
parents for symlinks. Paths reached through symlinks still use the explicit
fallback. Both strategies apply our
ignore compiler for glob filtering and the Go literal unindexed-file exception.
Literal folding uses Rust's native `(?i-u)` bytes-regex flag; non-ASCII literal
bytes remain exact. Regex folding uses Unicode `(?i)`, with Go's
ASCII Perl classes and word boundaries. The adapter preserves byte-based ranges,
rune-based snippets, line anchors, empty matches and final empty lines. Files
with a NUL in their first 8,000 bytes are skipped. The 8 MiB filter uses the
indexed size, matching Go. Request cancellation kills the processes. Complete
files acquire the 200-file cap; a 50-match file cap does not mark truncation.
Over 200 matching files, Go's racing workers make selection and truncation
nondeterministic, so exact response parity is only asserted through that boundary.

Matched-file binary checks use one native prefix read, with up to four complete
files processed concurrently. Each file retains match order and reaches the
file cap only after its callbacks finish; backpressure bounds queued files.
JSON path strings and
line/snippet buffers avoid redundant copies. Explicit batches share a four-thread
request budget. Raw responses use native file reads and buffer views while
preserving the HTTP range, modification and attachment behavior.

All temporary consistency code lives in `legacy/` for removal in phase 8:

- Index builds fetch legacy `/api/git/refresh` after its index is ready. One
  reconnecting `/api/git/stream` subscription applies every `git-status` event.
- Proxied Git mutations apply a returned GitStatusPayload, or fetch a refresh,
  before returning to the client. Hunk, pull, sync-agent and abort also rebuild
  the index because they can change files, including on failed operations.
- Bun save/new/close calls invalidate rendering caches, TouchPath the path,
  call legacy `/api/close` to evict Go rendering/LSP state, then refresh/apply
  Git before returning. Agent edit/batch/job/cancel, thread
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

## Rendering, files and observation

`render/document.ts` keeps immutable UTF-8 source bytes and a byte-offset line
index. It reproduces Go's final empty line, four-column tab stops, rune width,
20,000-column clamp and invalid-UTF-8 replacement per byte. CRLF normalization
happens before document creation. Files over 64 MiB or with a NUL in the first
8,000 bytes fail as in Go. Image and deleted variants retain their distinct
field sets. A `ref=` affects diff availability while the content still comes
from the working tree, including Go's deleted-file/base exception.

Highlighting uses 1,000-line chunks, 400 source context lines on either side and
a 512 KiB byte window. TextMate tokenizes only the leading context and requested
chunk; later source context remains available for grammar loading and byte-budget
decisions. Filename classification uses a bounded basename cache; content-based
classification is still evaluated per document. Oversized windows first drop context, then use escaped
plain text. Multi-chunk sources at most 2 MiB receive an asynchronous full pass;
larger files remain window-only. Requests share opening, chunk and render work.
The `exact` and `refine` flags retain Go's behavior, including oversized
single-chunk files that cannot become exact. Background work remains tracked
through L1 eviction and shutdown. Warm-ups are tracked too. Shutdown cancels
warm-up requests, settles exact passes and drains queued L2 writes before
terminating Workers. Closing a render pool is permanent; cancellation does not
log to stderr or escape a background task, preserving the workbench child exit
diagnostic.

The L1 LRU charges source bytes, line tables and rendered growth against
64 MiB. Every 10 seconds, after 15 seconds without a non-stream/non-metrics
request, it trims to 8 MiB and runs `Bun.gc(true)` in the process and render
Workers, once per activity burst. Like Go, both budgets retain the newest
document even when it alone exceeds the budget.

The L2 SQLite WAL cache lives at `$XDG_CACHE_HOME/faah/render.sqlite`, otherwise
`~/.faah/cache/faah/render.sqlite`. Rendered payloads are capped at 128 MiB and
evicted in LRU order shared across connections. Keys hash source content,
language, requested line count and `rendererVersion`; path associations allow
save/close/watcher invalidation without dropping another path's identical
content. Increment `rendererVersion` whenever grammar or scope mapping changes.
SQLite inserts and cache-hit recency/path updates run in a separate cache
Worker after the response path. Per-path revisions discard queued writes after
invalidation, and shutdown drains queued work before closing that Worker.
Shutdown keeps L2 content so a fresh process can reuse rendered chunks. The
budget counts stored payload bytes; SQLite pages, indexes and WAL add overhead.

`render/lexers.json` exports all 297 configurations from the pinned Chroma
v2.27.0 registry in registration order. Filename patterns, alias patterns,
priorities, editor backup suffixes and content analysers preserve Go's language
names, including `TypeScript` for TSX and lowercase `markdown`/`plaintext`.
The generated filename test vectors compare primary/alias/backup matches with
Go. `render/grammars.json` separately selects Shiki grammars, loaded lazily by
up to four Workers. The build embeds individual grammar JSON assets; a Worker
loads and decodes only requested grammars and their dependencies. After the index
builds, the render pool warms the three most common filename languages in the
background. `render/grammar-coverage.json` lists added compatible mappings and
languages without a bundled grammar. Names with no matching bundled grammar retain escaped plain
text; detection does not substitute a different language name.

`render/scopes.ts` is the explicit TextMate-to-theme mapping. Specific language
rules precede generic leaf scopes. Its complete output vocabulary is
`kt na nt nd nc no np err gi gd gh ge gs k nf nv nb s m o p cp c g`; ordinary
names remain unstyled. Context rules restore Python import namespaces and
adjust TypeScript, Go, Rust, shell, CSS and JSON scopes to Chroma's categories.
Only `&`, `<` and `>` are escaped in source tokens. Tokens keep Go's
`<i class=k>…</i>` shape. The contract comparator permits different token classes
and boundaries only in file lines and Markdown code blocks, validates nesting
and vocabulary, then compares escaped text exactly. All other fields and HTML
remain exact; see `test/contract/README.md`.

Markdown uses pinned markdown-it, footnote and task-list plugins with GFM table,
strikethrough and linkification rules. Custom renderers preserve heading ids,
duplicate tracking, container source markers, code wrappers, footnote ids and
raw HTML. The Markdown parser is shared, with per-request rendering state. Highlighted
fences use a bounded cache scoped to the highlight callback. Fences use the same render pool; unlabelled or oversized fences stay
plain. Preview limits and statuses remain 4 MiB / 413 / 415. CSV/TSV uses a
hand-written LazyQuotes parser with variable records, BOM stripping, delimiter
sniffing, physical line numbers, a 1 MiB read cap and 1,000 data rows. A byte-cut
final record is dropped as in Go.

Markdown preserves lone carriage returns as Goldmark does, and image alt text
includes inline code. Recognized lexers normalize carriage returns before
highlighting, including plaintext; the no-lexer fallback preserves source bytes.

`legacy/files.ts` is the only file metadata boundary. Git/LSP work runs in
parallel with Bun's reads/highlighting; it never requests legacy `/api/file`.
Normal HEAD-based diff availability uses the same index status rule as Go;
explicit refs ask the Go diff endpoint. LSP state, diagnostics, missing language
and running status come from Go. A disabled-LSP reply is immutable for that
child's lifetime and is reused. Saves use plain writes and create parents; new
paths preserve the 409 rule. These handlers deliberately retain Go's lack of an
Origin/Host mutation guard. Their typed decoder also preserves Go's field
folding, first-JSON-value behavior and error text.

`watch/` subscribes to the canonical workspace root, plus external Git/common
directories for linked worktrees. It filters hierarchical ignore rules and
`.git` noise, retaining HEAD/index/refs/packed-refs changes, then debounces for
50 ms. File events invalidate L1/L2, TouchPath the Bun index and refresh/apply
legacy Git state. Go's `GitWatcher.Refresh` broadcasts changed status to the
proxied Git/unified streams, so filesystem notifications can replace the polling
floor. A single startup `git update-index --refresh` primes Git's stat cache
before index readiness and watcher subscription, without staging working-tree
changes. Otherwise copied repositories can repeatedly rehash all tracked files.
Background child reads retain `GIT_OPTIONAL_LOCKS=0` to avoid index-lock races
with user mutations. Cache priming is best effort in read-only/non-Git folders.
Watcher startup/runtime errors warn
and fall back to Go's existing polling; shutdown unsubscribes before stopping
the child. The build generates a literal native `.node` dependency for its
platform. Linux builds default to glibc; set `FAAH_WATCHER_LIBC=musl` for musl.

Changes to any `.gitignore` rebuild the index and fuzzy shards so existing
files enter or leave search immediately. These notifications are retained even
when the new rules ignore `.gitignore` itself.

```sh
bun backend/bench/render-micro.ts
FAAH_LEGACY_BIN=/absolute/faah-go FAAH_BIN=/absolute/faah-bun bun backend/bench/token-agreement.ts
FAAH_LEGACY_BIN=/absolute/faah-go FAAH_BIN=/absolute/faah-bun bun backend/bench/differential.ts
```

Token agreement counts matching classes per non-whitespace UTF-8 byte and also
reports the subset where either renderer applies a class. The corpus sample is
50 files from each of Flask, Redis, React and Kubernetes, distributed across
available extensions and capped at 64 KiB per source. Go/Bun escaped text and
language names must agree before class agreement is calculated.

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

### Targeted profiling

```sh
FAAH_LEGACY_BIN=/absolute/faah-go FAAH_PROFILE_SEARCH=/tmp/faah-search.jsonl FAAH_PROFILE_REPORT=/tmp/faah-profile.jsonl bun --cpu-prof-md --cpu-prof-dir=/tmp backend/bench/profile.ts --bin /absolute/faah-bun
```

`FAAH_PROFILE_SEARCH` enables per-request timers only when supplied. They record
preparation, executable resolution, spawn, first stdout, rg completion, JSON
decoding, match validation, bytes/events, searched files/bytes, and child CPU.
The profile harness compares one/four rg threads, native ASCII folding, direct
and HTTP search, synchronous/sharded fuzzy queries, raw construction, and the
empty-search spawn floor. HTTP trials use fresh workspace copies so direct rg
trials do not prime their filesystem state. All reports stay outside the repo.

The optional walker observer separates synchronous walk-body time from its
remaining wall time and records process user/system CPU. The remaining wall
time includes filesystem awaits, runtime work and scheduling; it is not a kernel
I/O-wait counter. CPU totals include parallel filesystem threads and can exceed
wall time. Startup scheduling and the hidden Go child's walk are unchanged.

The earlier rg strategy measurements were warm: explicit parallel batches ran
before walking. A cold serial walk over the same 26,256 eligible Kubernetes files
and 230 MB reproduced the slow path; a parallel scan primed a much faster serial
follow-up. Folding syntax alone and mmap on/off did not reliably remove it.

The performance pass was verified with 36 backend tests, strict typechecking,
the frontend check, AIslop CI (zero new findings), three compiled Bun contract
runs at 257/257, the Go reference at 257/257, and the unchanged differential
check at 80/80. Sequential full Go then Bun runs over Flask and Kubernetes
passed the benchmark verifier without load errors or SSE timeouts. Raw trials
also compared every response byte with the fixture. Reports stayed outside
the repository; no contract goldens or recorded baselines changed.

In that isolated pair, Kubernetes no-hit search fell from the phase-2 4.65 s
to 322 ms (Go: 679 ms), and definition lookup measured 327 ms (Go: 694 ms).
Flask common search improved from 10.86 ms to 7.60 ms but remained slower than
Go's 2.68 ms. Kubernetes find queries remained 30–62% slower than Go despite
improving over phase 2. The 50K short-query microbenchmark fell from 2.795 ms
to 0.477 ms (Go baseline: 0.395 ms). Raw remained slower than Go, and Flask raw
rose by 0.025 ms versus phase 2. These are single-pair observations, not proof
of statistical significance; compare small deltas with the recorded Go repeat
swing before interpreting them.

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

The compiler runs in the output directory and removes `.bun-build` temporary
executables after success or failure, preserving the compiler's exit code.

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
reference also passes 257. The backend suite has 36 tests, including every Go
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
