# Frontend benchmarks

The vanilla frontend baseline completed five runs of every scenario: 45 successful
scenario pages and two separate CPU-profile passes, with no failures or skipped
scenarios. Recorded on 13 November 2026 IST (12 November UTC).

## Reproduce

```sh
npm ci
node scripts/build-web.js
go build -o faah .
npm run bench:web -- --runs 5 --json bench-out/comparison.json --out bench-out/comparison
```

The harness builds nothing. See the [harness guide](../../scripts/bench-web/README.md)
for options, exact timing boundaries, statistics, and rewrite instructions. Only
[selectors.js](../../scripts/bench-web/selectors.js) contains UI selectors. Raw
samples, fixture hashes, binary hash, and all profile summaries are in
[baseline-vanilla.json](../../scripts/bench-web/baseline-vanilla.json).

## Environment and workload

- Machine: Apple M4, 10 logical CPUs, 16 GiB RAM; Darwin 25.2.0, arm64.
- Browser: locally installed Google Chrome 157.0.8103.51, headless,
  `channel: 'chrome'`; Playwright Core 1.65.0. Bundled Chromium was not used.
- Build: Node v24.12.0, Bun 1.4.0 bundler, Go 1.27.3; binary faah 0.1.22 (darwin/arm64).
- Frontend source commit: `3e18f55cabee7a8b953de667795fb92aff279d5e`.
- Real corpus: React at `df6aa4ec76cff5b3adde531c6fe8c36099e0469b`,
  7275 tracked files and 7227 indexed files. Reused shallow clone in `bench-repos/react`.
- Synthetic corpus: 50k source lines, 5k Markdown lines, 20k CSV data rows,
  an eight-level chain with 20 branches holding 20k source files, plus twenty
  small tab fixtures; 20024 indexed files including its manifest.
- Each scenario/run uses a fresh context/page at 1440×900, scale 1. Servers are
  already indexed and reused across runs; browser HTTP/storage caches start empty.
  LSP, agents, telemetry, and updates are off; git awareness stays on.

## Baseline table

Action/frame samples are pooled across runs; scalar metrics have five samples.
Nearest-rank p95 of five scalars is the maximum. Input-to-visible timings include
two rAF callbacks to allow a paint; Event Timing reports only interactions at or
above 16ms. Bytes are raw bytes, not MiB.

| Metric | Unit | Samples | Median | p95 |
|---|---|---:|---:|---:|
| cold.real.tree | ms | 5 | 526.80 | 725.90 |
| cold.real.idle | ms | 5 | 1047.70 | 1254.20 |
| cold.real.js_transfer | bytes | 5 | 160765.00 | 160765.00 |
| cold.real.heap | bytes | 5 | 3126872.00 | 3165368.00 |
| cold.real.dom_nodes | nodes | 5 | 4064.00 | 4064.00 |
| cold.synthetic.tree | ms | 5 | 509.30 | 1089.70 |
| cold.synthetic.idle | ms | 5 | 1033.90 | 1618.30 |
| cold.synthetic.js_transfer | bytes | 5 | 160765.00 | 160765.00 |
| cold.synthetic.heap | bytes | 5 | 3107440.00 | 3112712.00 |
| cold.synthetic.dom_nodes | nodes | 5 | 4060.00 | 4060.00 |
| finder.keystroke | ms | 95 | 64.20 | 78.50 |
| file.open_50k | ms | 5 | 43.90 | 74.50 |
| scroll.frame | ms | 1200 | 16.70 | 16.80 |
| scroll.frames_over_16_7 | frames | 5 | 17.00 | 19.00 |
| scroll.long_tasks | tasks | 5 | 0.00 | 0.00 |
| scroll.long_task_total | ms | 5 | 0.00 | 0.00 |
| scroll.geometry_misses | checkpoints | 5 | 0.00 | 0.00 |
| scroll.content_misses | checkpoints | 5 | 0.00 | 0.00 |
| cursor.interaction | ms | 1500 | 24.00 | 40.00 |
| cursor.interactions_ge_16 | interactions | 5 | 300.00 | 300.00 |
| edit.enter_50k | ms | 5 | 1647.20 | 1674.60 |
| edit.keystroke | ms | 1000 | 103.90 | 126.60 |
| edit.interaction | ms | 1000 | 88.00 | 112.00 |
| edit.interactions_ge_16 | interactions | 5 | 200.00 | 200.00 |
| tabs.switch | ms | 50 | 31.45 | 36.00 |
| tree.expand_20k | ms | 5 | 1224.50 | 1452.70 |
| tree.reveal_deep | ms | 5 | 140.80 | 233.20 |
| search.results | ms | 5 | 895.60 | 972.30 |
| preview.markdown_5k | ms | 5 | 194.20 | 391.70 |
| preview.csv_20k | ms | 5 | 118.70 | 133.60 |
| memory.heap_delta | bytes | 5 | 409988.00 | 411328.00 |
| memory.dom_delta | nodes | 5 | 20.00 | 20.00 |
| memory.attached_delta | elements | 5 | 0.00 | 0.00 |

## Findings and limits

Large-file edit entry took a median 1.65s, and typing in that 50k-line textarea took
103.90ms per character to the paint boundary (Event Timing median 88ms). These are
the clearest interaction costs in this baseline. Search took 895.60ms including
its debounce and backend scan, so the frontend rewrite alone may not remove it.

Scrolling passed all 100 sampled geometry/content checkpoints and all final
checks: visible line 20,001 at the end, with 87 mounted source rows. There were no
≥50ms long tasks during the scroll windows. The strict >16.7ms counter includes
16.8ms intervals; it is not a count of whole missed display refreshes.

The CSV scenario opened the requested 20k-row file, but the app currently caps the
rendered table at **1,000 rows**. The row count is preserved in each run's details.
All requested scenarios ran; none were substituted or skipped.

After twenty tab opens/closes and GC, median retained heap grew by 409,988 bytes
(0.391 MiB), and total DOM nodes grew by 20; attached elements grew by zero. This
is one warmed cycle, not proof of a leak. Closed-tab history and caches may retain
state intentionally. Harness Performance Timeline entries are cleared before GC.

## CPU profiles

These are separate diagnostic passes and do not affect the baseline table. Self
time includes idle, runtime, native DOM work, and benchmark instrumentation. Raw
profiles stay in gitignored `bench-out/`; use a different `--out` for the rewrite.
The profiles include opening the file through the finder before scrolling.

The largest named application frame while scrolling is `ze` (the current bundled
`paint` function): 1,593.83ms self time, 37.60% of the complete sampled profile.
That is a useful place to compare rendering work after the rewrite. Names are
minified; use the recorded bundle positions and binary hash to identify frames.

### profile.finder

Profile: [bench-out/profile.finder.cpuprofile](../../bench-out/profile.finder.cpuprofile)

| Frame | Self ms | % of sampled time | Bundle location |
|---|---:|---:|---|
| `(idle)` | 1542.50 | 85.71 | runtime/native/harness |
| `(program)` | 167.22 | 9.29 | runtime/native/harness |
| `scrollIntoView` | 28.67 | 1.59 | runtime/native/harness |
| `ze` | 7.53 | 0.42 | app.js:4:10309 |
| `showModal` | 7.37 | 0.41 | runtime/native/harness |
| `Mp` | 5.06 | 0.28 | app.js:59:19403 |
| `querySelector` | 4.92 | 0.27 | runtime/native/harness |
| `requestAnimationFrame` | 3.80 | 0.21 | runtime/native/harness |
| `n` | 2.58 | 0.14 | app.js:1:739 |
| `Tp` | 2.52 | 0.14 | app.js:59:17173 |
| `evaluate` | 2.51 | 0.14 | runtime/native/harness |
| `Cp` | 2.47 | 0.14 | app.js:59:19206 |
| `iu` | 1.60 | 0.09 | app.js:4:6608 |
| `querySelectorAll` | 1.26 | 0.07 | runtime/native/harness |
| `fetch` | 1.26 | 0.07 | runtime/native/harness |

### profile.scroll

Profile: [bench-out/profile.scroll.cpuprofile](../../bench-out/profile.scroll.cpuprofile)

| Frame | Self ms | % of sampled time | Bundle location |
|---|---:|---:|---|
| `(idle)` | 2020.85 | 47.67 | runtime/native/harness |
| `ze` | 1593.83 | 37.60 | app.js:4:10309 |
| `(program)` | 507.53 | 11.97 | runtime/native/harness |
| `(garbage collector)` | 35.50 | 0.84 | runtime/native/harness |
| `(anonymous)` | 11.12 | 0.26 | runtime/native/harness |
| `showModal` | 8.80 | 0.21 | runtime/native/harness |
| `pe` | 8.79 | 0.21 | app.js:5:5128 |
| `(anonymous)` | 6.28 | 0.15 | app.js:1:1312 |
| `querySelectorAll` | 5.12 | 0.12 | runtime/native/harness |
| `og` | 5.09 | 0.12 | app.js:4:5860 |
| `scrollIntoView` | 3.77 | 0.09 | runtime/native/harness |
| `s` | 3.77 | 0.09 | app.js:1:1250 |
| `(anonymous)` | 3.76 | 0.09 | app.js:1:1446 |
| `requestAnimationFrame` | 2.59 | 0.06 | runtime/native/harness |
| `j` | 1.68 | 0.04 | app.js:158:4215 |

## Validation

The six statistics/profile unit tests, existing frontend check (51 passing tests,
one existing optional tips-file skip), and full Go suite pass. The benchmark
finished with zero failures. No files under `web/` or Go source were changed.
