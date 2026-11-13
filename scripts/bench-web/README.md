# Frontend performance harness

This harness measures the served browser UI without importing frontend modules,
calling application globals, or invoking file/search APIs to perform interactions.
All UI selectors and shortcuts live in [selectors.js](selectors.js). When the UI
changes, update that contract and keep the fixtures, timing boundaries, viewport,
and workloads unchanged. A selector failure is an error, not a zero-latency sample.

## Run

Requires Node 20+, a prebuilt faah binary, and Google Chrome. Playwright Core is an
exact pinned development dependency; it does not download a browser during npm ci.

```sh
npm ci
node scripts/build-web.js
go build -o faah .
npm run test:bench-web
npm run bench:web -- --runs 5 --json bench-out/frontend.json
```

The harness **never builds** the frontend or binary. Google Chrome is launched
headlessly with `channel: 'chrome'`. Only if Chrome is absent does it try the
Playwright-managed Chromium revision. Install that fallback explicitly with
`npx playwright-core install chromium`. JSON records which browser and version ran;
use the same version for comparisons.

```sh
npm run bench:web -- --binary /path/to/faah --workspace /path/to/large/repo \
  --runs 5 --json bench-out/frontend.json --out bench-out/frontend
```

`--workspace` defaults to a shallow React clone in `bench-repos/react`, matching
one of the Go benchmark corpora. The clone is reused. Its commit is in the JSON;
check out that same commit for comparisons. An explicit workspace is never cloned
or modified. The synthetic corpus is separate, under `bench-repos/web-synthetic-v1`.
Override it with `--synthetic PATH` (an empty directory on first use).
`--out PATH` changes the default `bench-out/` diagnostics directory.

The deterministic synthetic corpus contains:

- A 50,000-line JS file with a unique visible marker on each source line.
- A 5,000-line Markdown document with headings, links, and bold paragraphs.
- A CSV with 20,000 data rows plus one header.
- 20,000 source files under an eight-level directory chain and 20 branches.
- Twenty small source files for tabs and one generator manifest.

The generator refuses to overwrite a nonempty unrecognized directory. Primary
fixture sizes and hashes are recorded; edit tests type unsaved text and discard it.
Generated corpora and diagnostics are gitignored. To compare with a previous run, pass its
JSON explicitly: `--baseline bench-out/previous.json`. The output includes absolute and
percentage median changes for common metrics with matching units. A zero reference median
has no percentage change; missing metrics are omitted. No baseline is loaded by default.

## Measurement contract

Each scenario in each run gets a fresh browser context/page, with a 1440×900
viewport, scale 1, en-US locale, UTC timezone, empty browser cache/storage, and
unmodified motion preferences. Two isolated servers remain running across runs.
They bind free ports with `-port 0 -no-open`; language servers, harness agents,
updates, and telemetry are disabled. Git awareness stays enabled. Temporary XDG
config/state directories prevent personal settings from changing the workload.
Readiness waits for the server URL and `/api/meta` reporting `ready: true`.
Consequently, “cold” means cold **browser** load against an already indexed server;
it does not measure process startup, OS file cache misses, or backend cold caches.

| Scenario | Boundary / workload |
|---|---|
| Cold, real and synthetic | Navigation start → first rendered tree rows (browser observer/rAF); navigation start → 500ms without a ≥50ms long task after tree readiness. |
| Cold resources | Resource Timing JS `transferSize` (includes headers), encoded/decoded bytes in details; CDP used heap without forced GC; CDP total DOM nodes (includes detached nodes). |
| Finder | Mod+P, type the source filename one character at a time; capture-phase `input` → mutation in the results list → two rAF callbacks. Enter `keydown` → first marked code lines → two rAF callbacks. |
| Scroll | Move native scrollTop over 20,000 lines in 240 linear rAF steps. Record frame intervals, frames >16.7ms, ≥50ms long tasks, and 20 checkpoints of visible gutter/scroll geometry and line-marker correctness. Wait up to 10s for final content. |
| Cursor | Click first source line; 300 repeated ArrowDown keydowns followed by keyup. Event Timing durations grouped by interactionId (maximum duration per interaction). |
| Edit | Enter the 50k-line file's edit mode, accept its documented large-file confirmation, type 200 single characters at the start, then discard. `input` → two rAF callbacks and Event Timing interactions. |
| Tabs | Open ten small files through the finder; click each tab, measuring capture-phase click → unique visible file marker → two rAF callbacks. |
| Tree/search | Expand all 20k files until the busy control resets, collapse, open the deeply nested target via finder (Enter → explorer row revealed), then full-text query `input` → visible matching search row. |
| Previews | Finder Enter → visible Markdown heading or CSV table content, including the app's default preview behavior. Record the actual rendered CSV row count. |
| Memory | Warm one open/close, GC and record heap/DOM, open twenty distinct tabs, close all, wait idle, GC again. Compare equal empty-tab states; record attached elements as well as all CDP DOM nodes. |

User-action latencies use browser `performance.now()`, excluding Playwright
transport and setup. Two rAF callbacks provide a consistent opportunity to paint;
these are observable response times, not isolated JS handler timings. Waiting for
every finder response intentionally measures serialized keystrokes. This is not a
fast-typing cancellation test. Cursor repetition is transport-paced, not OS-paced.

Event Timing uses `durationThreshold: 16`. Durations are browser-quantized and
include only reported interactions at/above that threshold. Missing slow events
produce an empty distribution and a zero count, not an invented zero-ms duration.
The JSON preserves raw entries and per-run samples. Scroll intervals are rounded
to 0.001ms, with a tiny floating-point tolerance at the 16.7ms threshold. An interval
just above 16.7ms counts as requested, even if it did not miss a whole display frame.
Checkpoint DOM reads add some measurement overhead and can detect transient blank
content; final geometry/content failure fails the scenario.

The stdout table and JSON summary pool action samples across runs. Scalar metrics
have one sample per run; keystrokes, tab switches, frames, and interactions have
multiple samples. Median interpolates the middle pair; p95 is nearest-rank, so
with five scalar samples p95 is the maximum. Inspect raw runs before treating a
small difference as a regression. Keep the machine, browser, corpus, build tool,
power mode, and competing work consistent for comparisons.

Harness-owned Performance Timeline entries are cleared before both memory samples.
One open/close cycle measures retained growth, not proof of a leak. Deliberate
closed-tab history, caches, and browser allocations may survive GC. Check repeated
cycles separately if retained growth becomes a concern.

## Profiles, failures, and checks

Finder/open, scrolling, editing, tree/search and memory each get a separate diagnostic pass with CDP CPU
profiling at a requested 1ms sampling interval. These passes do not enter the
timing summary. Profiles are written to `bench-out/profile.finder.cpuprofile` and
`bench-out/profile.scroll.cpuprofile`; stdout and JSON include the top 15 frames by
self time, calculated from sample time deltas. Idle, runtime, native DOM work, and
benchmark instrumentation are included. Minified function names are meaningful
only together with the recorded binary hash and bundle line/column.
The editor and tree/search diagnostics also write Chrome timeline traces, reporting
native layout/style/paint time alongside sampled JavaScript. The memory diagnostic
writes a sampled live-allocation profile (4 KiB sampling interval); its estimates
include warm-up and are not an exact retained-heap delta. None of these diagnostic
passes enters the timing summary.
Use a separate `--out` directory for later comparisons to preserve these profiles.

Each action has a 15s timeout, navigation 30s, startup 60s, and scenarios a 180s
deadline. Failures name the scenario/run and selector where applicable; screenshots
and HTML snapshots go to the diagnostics directory. Remaining scenarios still run,
JSON records failures, failed scenarios are excluded from aggregate statistics,
and the command exits nonzero. Servers/browser are stopped on exit or interruption.

`npm run test:bench-web` runs dependency-free node:test checks for median, p95,
aggregation, frame thresholds, interaction grouping, and CPU self-time attribution.
