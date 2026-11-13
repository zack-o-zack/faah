# Backend comparison harness

Requires Bun, Git, `ps`, `cp`, and the repo's installed TypeScript (`npm ci` if
`node_modules` is absent). No benchmark npm dependencies. The small runtime
declaration in `runtime.d.ts` describes only the Bun APIs used here.

```sh
bun bench/corpus.ts
node_modules/.bin/tsc -p bench --noEmit
npm run build
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tmp/faah-go .
bun bench/run.ts --bin /tmp/faah-go --label Go-A --out bench/results/go-A.json
bun bench/run.ts --bin /tmp/faah-go --label Go-B --out bench/results/go-B.json
bun bench/report.ts bench/results/go-A.json bench/results/go-B.json
bun bench/micro.ts /tmp/faah-go
```

Run sequentially on an otherwise quiet machine. `--repos flask,redis` selects a
subset. `--quick` uses 5 measured requests, 2 SSE samples per mode, 2-second load
windows and 10-second idle; full runs use 30, 10, 10 seconds and 60 seconds.
Both use 5 warmups and 5 fresh startup launches. Quick results are smoke tests,
not a baseline. Corpus setup shallow-clones each project, persists each first
SHA, and fetches/checks out that exact SHA thereafter. Do not edit the cache.
Every launch receives a fresh APFS copy (`cp -c -R`, plain copy fallback), except
the workbench/direct comparison which shares its own clean copy. All mutations
are disposable. No requests target the pinned corpus. Processes get temporary
HOME and XDG roots, with LSP, agents, telemetry and updates disabled. Shutdown
closes stdin, waits up to 6 seconds, then kills if necessary and removes state.
Normal and exceptional scenario exits clean up the workspace and process.

The binary must support faah's child/desktop flags and ready-line protocol.
All benchmark behavior uses HTTP, SSE, file writes and OS process inspection;
there is no Go API dependency. `micro.ts` is the separate Go-only exception.
The compiled binary must include the frontend build; never use `make build`
or `replace-local.sh` for an isolated measurement.

## Measurements

- Startup: spawn to first successful metadata response, and spawn to metadata
  reporting `ready=true`. A 5 ms sequential polling interval introduces polling
  quantization. Polling starts at the child ready line; first HTTP is therefore
  an upper bound on the earliest possible HTTP availability. Median and minimum
  over five fresh processes; full samples retained. These are process-cold,
  OS-page-cache-warm launches, not a reboot or disk-cache purge.
- Latency: monotonic elapsed time including fetch, body transfer and decoding
  to bytes; JSON parsing/count validation follows timing. Nearest-rank p50,
  p95, p99, arithmetic mean and minimum. Request query parameters are recorded.
  Counts are lines, matches, children, symbols, definitions, rendered Markdown
  characters, hunks, changed lines, CSV rows or indexed files as appropriate.
  Search also retains file count and truncation per request. Full responses
  are validated for status and required count fields; bodies themselves are
  not retained. Body sizes count decompressed bytes.
- Fixtures: largest tracked source under 2 MB; typical source nearest 300 lines
  among the first 500 sorted 4–24 KB candidates; three basename-derived find
  queries; a source identifier for rare search and a declaration symbol for
  definition lookup. `return` is the common/case-sensitive whole-word query.
  Regex is `(function|return|class)\s+\w+`. The synthetic no-hit token is fixed.
  A tracked Markdown README and tracked CSV with the most lines are used. Missing CSV is
  explicitly skipped. Fixture selection reads files before server launch.
- Cold/warm: consecutive first and second large-file opens in a new server,
  before any other file request. This measures backend document/highlight cache
  effects; it does not mean the OS file cache is cold. Warm latency scenarios
  follow. Source files are then modified for diff/gutter.
- SSE: one `/api/stream` parser consumes named event/data frames, including
  multi-line data. Each mutation starts from confirmed clean Git state and
  waits for `git-status.gitFiles` to contain the tracked file; restore waits
  until it disappears. API save and direct filesystem writes are separate
  groups. Restores use the same mutation method as their group, so external
  samples do not inherit API-triggered refresh work. Timer begins before mutation, so save includes its HTTP time. Timeout
  is 15 seconds; percentiles exclude timeouts, which are counted and retained.
  External-edit results reflect adaptive polling after recent API activity;
  they do not represent a workspace that has been idle for many minutes.
- Throughput: closed-loop clients at C=1,8,32 cycle meta/tree/find/file/search
  for 10 seconds each. Every worker has at most one request outstanding. Rate
  includes final in-flight completion time. No think time or arrival-rate model.
  Samples use mixed request latencies; error count and messages are retained.
- Responsiveness: four regex-search clients run alongside one sequential meta
  client for 10 seconds; both foreground and background samples are retained.
- Memory: `ps` sums PID and recursively discovered descendants' RSS bytes after
  ready, then approximately every 100 ms through latency, SSE and load. Sampling
  subprocess overhead is part of the harness. Peak is sampled, not a kernel
  high-water mark. Sampling stops before the final 60-second idle wait, followed
  by a final RSS measurement. Idle Go memory need not fall without GC pressure.
- Workbench: once per run, desktop spawn to ready line, JSON POST open to proxy
  metadata reporting ready, then proxy and direct meta latency (5 warmups).
  The direct server is independent; both processes are alive for that comparison.
- Binary size: filesystem size in bytes of the specified executable.

## JSON schema (version 1)

`environment` records label, absolute binary path/size, source commit, OS/kernel,
CPU, core count, Bun/Go versions, timestamp, corpus SHAs, flags and run settings.
The source commit is the checked-out backend source; the executable must be
rebuilt by the operator when source changes. `repos[]` contains name, fixture,
startup, coldWarm, latency, skipped, sse, throughput, responsiveness and memory.
Times are milliseconds, memory and body sizes bytes, throughput requests/second.
`startup.samples[]` has firstMs, readyMs, RSS and every successful meta sample.
`latency[]` has name/route/params, a latency summary and raw samples with
`ms,status,bytes,count,counts`. `coldWarm` contains two such samples. `sse[]`
has mode, latency summary, timeouts and raw samples (including save response).
`throughput[]` and responsiveness load objects include specs, elapsedMs,
concurrency, requestsPerSecond, latency, errorCount/errors, and raw tuples:
`[scenarioIndex, ms, status, bodyBytes, resultCount]`. `memory.samples[]` contains
elapsed ms and process-tree bytes. `workbench` contains spawnReadyMs, openReadyMs,
open response sample, proxy and direct measurements. `.partial` checkpoints are
incomplete and must not be used as final baselines. Reports compare every scalar
summary metric using `(b/a - 1)*100`; positive throughput is better, while lower
latency, RSS, size and errors are better. Two same-backend runs quantify observed
noise only; they do not establish statistical significance.

## Go microbenchmark vectors

`micro.ts` executes all default (not harness-tagged) benchmarks in fuzzy, ignore,
render, symbols and table, plus root Search/Snip/HandleFile/SortNodes/GitStatus,
with `-run=^$ -benchmem -count=3`. Raw output and per-name median ns/op, B/op and
allocs/op plus all three samples are saved separately. Root LSP/agent benchmarks
are intentionally excluded. The JSON includes the same environment metadata.

Exact vectors remain in these existing test files; preserve their contents and
loop semantics when porting (cache hits versus fresh construction matter):

| Source                             | Input                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal/fuzzy/fuzzy_test.go`     | Eight HTTP-ish paths, `httpserver` top 5; single-path score; generated 1K/10K/50K paths across eight directories/extensions, queries `handler`, `srvutil`, `in`, top 50                                                            |
| `internal/ignore/ignore_test.go`   | Seven rules incl. negation, root anchor and `**`, six cycling paths; five cycling compile patterns                                                                                                                                 |
| `internal/render/render_test.go`   | Tiny greet diff; hello-world Go; Markdown heading/list/fence; Go WorkerPool and Python Config hot documents; 200 repeated Go lines for creation/cold highlight                                                                     |
| `internal/symbols/symbols_test.go` | Ten extensions; `ProcessRequest` declaration patterns; six-line Go Client declarations; Markdown heading hierarchy; spaces/tabs indentation                                                                                        |
| `internal/table/table_test.go`     | Six-column, four-row employee CSV; header plus Alice row for delimiter sniffing                                                                                                                                                    |
| `px0_test.go`                      | Snip byte offsets 9–28 in HTTP handler line; 20 files with TargetSearchToken; 40 repeated miss files + TargetSymbolDef hit; 64 reverse-name nodes (every fifth a directory); server.go scroll start=300,count=300 through httptest |
| `git_test.go`                      | `gitRepo(b)` disposable repository with staged/modified/deleted/untracked changes, invoking real Git status                                                                                                                        |

The scroll microbenchmark reads this repository's `server.go`; corpus scenarios
use pinned upstream files instead. Go default microbenchmark duration is retained.

Validate a completed run with `bun bench/verify.ts RESULT.json`. This rejects
unexpected empty results, nonzero no-hit results, HTTP errors and load errors;
it reports SSE timeouts and missing CSV separately. Generate the full baseline
summary and per-metric repeat variance with:

```sh
bun bench/summary.ts bench/results/go-c32fe4e.json bench/results/go-c32fe4e-repeat.json bench/results/go-c32fe4e.md
```
