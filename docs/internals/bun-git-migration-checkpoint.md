# Render checkpoint before the Git migration

Source commits:

- `42333ba` Restore render and table throughput.
- `9d17ecb` Avoid redundant work when opening document windows.

Nothing was pushed. Part B is not implemented. Git and workspace SSE ownership
remain with the legacy server.

## Evidence and artifact loss

The scratch directory and `/tmp` reports disappeared externally during the final
verification pipeline. Its running tool sessions also disappeared. The source
commits survived. The cause of the cleanup is unknown. This file reconstructs
only values retained in tool output; the individual benchmark samples are lost.
Do not treat unobserved pipeline steps as completed.

The original scratch binary, brief, backend map, prior reports, visual captures,
and resume notes were also removed. Recreate reference binaries before resuming.
The pinned corpus remains under `~/.cache/faah-bench/repos`.

## Throughput comparison

A detached scratch worktree at `8495955` shared dependency directories through
symlinks. Worker bundles were built for both revisions. The unchanged
`backend/bench/render-micro.ts` ran baseline then candidate three times, followed
by three more baseline/fixed pairs after the fixes. Each process reports the
median of three timed samples. The table contains medians of three process runs
from the confirmation comparison. The scratch worktree was removed afterward.

| Microbenchmark (ns/op) |       8495955 |       42333ba | Fixed / baseline |
| ---------------------- | ------------: | ------------: | ---------------: |
| HighlightLines_Go      |        647.09 |        234.80 |            0.363 |
| HighlightLines_Python  |        530.67 |        226.56 |            0.427 |
| NewDoc                 |     57,490.23 |        971.49 |            0.017 |
| DocCreation            |    270,984.91 |     23,349.43 |            0.086 |
| ColdHighlight_Go       | 39,797,229.25 | 15,357,825.00 |            0.386 |
| RenderMarkdown         |    572,815.92 |     25,357.67 |            0.044 |
| RenderTable            |      5,832.75 |      2,835.07 |            0.486 |
| SniffDelim             |        792.07 |        299.24 |            0.378 |

Every fixed median is below the contemporaneous old-revision median. These are
not the historical absolute values. The old revision also measured much slower
in this session. Final micro follow-ups after `9d17ecb` were queued, but their
results were not observed before artifact loss; rerun them.

Table parsing, UTF-8 decoding, shared text helpers, and the micro harness were
byte-identical between `8495955` and `775dae5`. Table rendering was effectively
unchanged in the initial paired comparison. The alleged shared decoder change
did not occur. Sniffing reproduced a slowdown in the full harness despite
identical source; fresh-process table/sniff-only probes gave similar medians for
both revisions (sniff approximately 1,155 versus 1,164 ns, table 5,227 versus
5,297 ns). This demonstrates workload-history sensitivity. A specific JIT or GC
mechanism was not established.

The fixes cache filename classification in a bounded 4,096-entry basename map,
count four candidate delimiters without a Map or per-character array search,
and slice unquoted CSV fields once instead of concatenating characters. Content
analysis remains per document; filename case, backup matching, lexer priority,
delimiter tie order, quoting and CSV line accounting are preserved. The grammar,
scope-class and Markdown correctness improvements were not reverted.

## Cold-open changes and remaining measurements

The existing pre-change profile, in milliseconds:

| Stage                 | Flask / Python | Kubernetes / Go | Decision                                                                                         |
| --------------------- | -------------: | --------------: | ------------------------------------------------------------------------------------------------ |
| Engine setup          |          1.595 |           1.439 | Start the first Worker alongside index construction.                                             |
| Grammar load          |         14.346 |           9.660 | Keep lazy loading and typed decoding; further decoder work needs a separate measured experiment. |
| First-window tokenize |         77.934 |         107.252 | Tokenize only leading context and the requested chunk.                                           |
| Document open         |          4.745 |          27.274 | Cache filename classification and skip provably unnecessary width scans.                         |

The first-window profile above tokenized 1,400 lines. The new path requests
1,000 lines for the first chunk. It still sends trailing source context to
preserve lazy fence-grammar loading and the original byte-budget decision.
TextMate tokenizes forward one line at a time, so later lines cannot alter
already-tokenized lines. Middle chunks retain 400 leading context lines.

Width pruning uses the bound of four columns per source byte, including tabs
and invalid UTF-8. It skips a line only when it cannot exceed the known maximum,
or after reaching the public 20,000-column clamp. Top-language warming still runs
after index readiness; only Worker initialization starts earlier.

An engine experiment kept the production JavaScript engine: JS setup was
2.455 ms and first windows were 134.991 / 125.894 ms; Oniguruma WASM setup was
48.938 ms and windows were 159.176 / 199.775 ms. Output matched for all 158 mapped
grammar samples and 158 real corpus files tested. WASM was slower. Experimental
production-tree files were removed before the checkpoint.

The alternating HTTP experiment was queued but its results were not observed.
No new cold-open ratio or achievement of the approximately 1.5-times-Go target
is claimed. Rerun five fresh Go/Bun pairs for each repository, in alternating
Go/Bun order, with independent temporary workspace copies and fresh render
caches. Use these largest-file paths:

- Flask: `src/flask/app.py`.
- Kubernetes: `staging/src/k8s.io/api/core/v1/generated.pb.go`.

Record every first-window sample and its paired Bun/Go ratio. Reprofile engine
setup, grammar load, tokenization and document opening after the changes.

## Validation status

Strict backend TypeScript and all 66 backend tests passed again after the
artifact loss. Before the loss, `npm run check` passed 375 frontend tests and
aislop reported zero new findings. Three preflight Bun contract runs passed
257/257; only the third was entirely on the final source. Additional exact-source
repetitions were queued. The Go reference run was observed in progress, not
completed. Differential output and final timing outputs were not observed.

Required before claiming complete verification: rebuild both binaries; run Bun
contracts 257/257 three times, Go 257/257, differential 167/167, strict TS, backend
tests, check and aislop. Keep the final source fixed throughout the repetitions.
Do not reuse the earlier phase's successful counts as evidence for these commits.

## Resume Part B

First finish the missing render verification and alternating cold ratios. Then:

1. Port `git.go` to small modules under `backend/src/git/`. Preserve argv,
   `--` termination, prompt suppression, safe-directory fallback, probe caching,
   subtree-relative paths, porcelain-v2 NUL parsing, renames, unmerged/staged/
   partial states, name-status/stat/log/numstat, root/merge diffs and ahead/behind.
   Bound `Bun.spawn` concurrency and parse large output incrementally.
2. Use one authoritative native Git snapshot, serialized into `Index.applyGit`.
   Replace Git acquisition and watcher refresh calls in `index/navigation.ts`.
   Remove payload application and the internal Git subscription from
   `legacy/navigation.ts`; retain after-proxy native-refresh hooks. Split native
   Git fields from LSP adaptation in `legacy/files.ts`.
3. Own `/api/git/{refresh,stage,unstage,hunk,commit,push,pull,sync-state,abort,log}`,
   `/api/unpushed`, `/api/commitfiles`, `/api/commitdetail`, `/api/diff`, `/api/gutter`,
   `/api/stream`, `/api/git/stream`, and Git fields of `/api/meta` and `/api/file`.
   Render diff hunks through the Bun render path with Go-equivalent rows.
4. Keep commit-message, sync-agent, snapshots/revert and PR URL workspaces
   proxied at their specified migration boundaries. Refresh native Git/index
   after applicable proxied writers, including failed or asynchronous operations.
   Leave extension points for PR base/frozen-head/your-status semantics.
5. Extend `watch/service.ts` metadata coverage to FETCH_HEAD, MERGE_HEAD and
   rebase metadata as well as HEAD/index/refs/packed-refs. Debounce worktree
   refreshes at 50 ms; compute with subscribers or on demand; suppress unchanged
   payloads. If watching fails, use 1-second metadata and adaptive 1–10-second
   status polling.
6. Own SSE metrics at 2.5 seconds and native git-status. Forward only thread/
   review events through one internal legacy stream subscription per process.
   Preserve query modes, event names, headers, 15-second pings, thread buffer256,
   fan-in64 and slow-subscriber closure. Inspect Go's stream/thread subscription
   semantics before designing the adapter. The current `http/sse.ts` enqueueing
   is unbounded and needs replacement.
7. Port non-agent/non-PR Git tests into temporary repositories, including parser
   fixtures and watcher-driven refresh. Extend differential coverage with Git.
   Update `docs/internals/backend.md`; commit phase4 separately.
8. Alternate fresh Go/Bun launches for Flask/Kubernetes Git refresh, diff,
   gutter, log, commit detail, stage/unstage, metadata and SSE save/external-edit
   propagation. Report paired ratios and hidden Go watcher CPU costs. Run the
   complete contract/differential/check gates before claiming phase4 complete.

Rebuild reference binaries with `go build -o <scratch>/bin/faah-go .` and
`FAAH_BUILD_OUT=<scratch>/bin FAAH_BUILD_NAME=faah-bun bun run backend:build` after
building frontend assets. Never edit Go, frontend, desktop, goldens or
`bench/results`. Keep strict TS, no casts/any/non-null assertions, no stash/reset,
no push and no automatic Rams review. Stop below500MB free and promptly remove
owned temporary clones/build leftovers. Keep durable copies of reports outside
temporary directories when recreating the scratch notes.
