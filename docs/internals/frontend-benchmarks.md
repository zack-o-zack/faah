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

## A1 — 13 November 2026

Five runs on the same M4, Chrome 157.0.8103.51, React revision and synthetic
fixture hashes as the vanilla baseline. Harness: Node 24.12.0; frontend build:
Vite 8.3.8 under Node 24.15.0; Go 1.27.3; implementation `d2ad991`.
Values use the existing pooled-sample
contract. Raw samples and paired trace and heap summaries stay in the ignored `bench-out/`.

| Metric | Unit | Vanilla median / p95 | A1 median / p95 | Median change |
|---|---|---:|---:|---:|
| cold.real.tree | ms | 526.80 / 725.90 | 495.90 / 718.00 | -5.9% |
| cold.real.idle | ms | 1047.70 / 1254.20 | 1013.00 / 1237.20 | -3.3% |
| cold.real.js_transfer | bytes | 160765.00 / 160765.00 | 166781.00 / 166781.00 | 3.7% |
| cold.real.heap | bytes | 3126872.00 / 3165368.00 | 3601100.00 / 3610660.00 | 15.2% |
| cold.real.dom_nodes | nodes | 4064.00 / 4064.00 | 4133.00 / 4133.00 | 1.7% |
| cold.synthetic.tree | ms | 509.30 / 1089.70 | 506.90 / 524.40 | -0.5% |
| cold.synthetic.idle | ms | 1033.90 / 1618.30 | 1019.40 / 1039.00 | -1.4% |
| cold.synthetic.js_transfer | bytes | 160765.00 / 160765.00 | 166781.00 / 166781.00 | 3.7% |
| cold.synthetic.heap | bytes | 3107440.00 / 3112712.00 | 3563904.00 / 3574940.00 | 14.7% |
| cold.synthetic.dom_nodes | nodes | 4060.00 / 4060.00 | 4059.00 / 4059.00 | 0.0% |
| finder.keystroke | ms | 64.20 / 78.50 | 77.30 / 79.20 | 20.4% |
| file.open_50k | ms | 43.90 / 74.50 | 45.90 / 70.60 | 4.6% |
| scroll.frame | ms | 16.70 / 16.80 | 16.70 / 16.80 | 0.0% |
| scroll.frames_over_16_7 | frames | 17.00 / 19.00 | 13.00 / 16.00 | -23.5% |
| scroll.long_tasks | tasks | 0.00 / 0.00 | 0.00 / 0.00 | — |
| scroll.long_task_total | ms | 0.00 / 0.00 | 0.00 / 0.00 | — |
| scroll.geometry_misses | checkpoints | 0.00 / 0.00 | 0.00 / 0.00 | — |
| scroll.content_misses | checkpoints | 0.00 / 0.00 | 0.00 / 0.00 | — |
| cursor.interaction | ms | 24.00 / 40.00 | 24.00 / 40.00 | 0.0% |
| cursor.interactions_ge_16 | interactions | 300.00 / 300.00 | 300.00 / 300.00 | 0.0% |
| edit.enter_50k | ms | 1647.20 / 1674.60 | 529.30 / 551.30 | -67.9% |
| edit.keystroke | ms | 103.90 / 126.60 | 36.50 / 40.20 | -64.9% |
| edit.interaction | ms | 88.00 / 112.00 | 40.00 / 40.00 | -54.5% |
| edit.interactions_ge_16 | interactions | 200.00 / 200.00 | 200.00 / 200.00 | 0.0% |
| tabs.switch | ms | 31.45 / 36.00 | 30.65 / 35.00 | -2.5% |
| tree.expand_20k | ms | 1224.50 / 1452.70 | 1128.10 / 1164.60 | -7.9% |
| tree.reveal_deep | ms | 140.80 / 233.20 | 114.40 / 186.20 | -18.8% |
| search.results | ms | 895.60 / 972.30 | 874.50 / 887.10 | -2.4% |
| preview.markdown_5k | ms | 194.20 / 391.70 | 119.60 / 185.10 | -38.4% |
| preview.csv_20k | ms | 118.70 / 133.60 | 103.90 / 106.00 | -12.5% |
| memory.heap_delta | bytes | 409988.00 / 411328.00 | 602756.00 / 603528.00 | 47.0% |
| memory.dom_delta | nodes | 20.00 / 20.00 | 20.00 / 20.00 | 0.0% |
| memory.attached_delta | elements | 0.00 / 0.00 | 0.00 / 0.00 | — |

- Global CSS Highlight rules made every explorer node compute highlight inheritance.
  Three expansion-only traces per variant measured median style recalculation of
  671ms at `33c8596`, 1,012ms before the fix and 668ms after scoping to `#rows`.
  Median expansion was 1,132 / 1,502 / 1,135ms respectively; tree source is unchanged.
- Finder remains 20.4% above the original vanilla table. Fresh three-run comparisons
  of `33c8596` and A1 measured 76.1 / 77.4ms (p95 79.6 / 79.1ms), a 1.7% A1
  difference. Both runs retain the 40ms debounce and two rAF callbacks; the
  final finder CPU profile is 82% idle. The paired cursor medians were both 32ms;
  300 keydown dispatches took 87 / 83ms total and style work fell 130 / 74ms.
- Full cold heap snapshots after GC: baseline 1,914,604 bytes; A1 2,337,388 bytes
  (+422,784). Compiled code accounts for +218,936 bytes, objects +31,848, closures
  +24,256 and arrays +23,812. There are no file-sized startup buffers; Vim help
  is unmounted. Selection actions now mount on demand, and ending editing or
  closing the tab clears the native textarea's full-text copy.
- In separate snapshot runs, the first tab cycle retained 435,236 / 642,576 bytes
  (baseline / A1). Cold-to-first-cycle compiled code grew 810,812 / 975,368 bytes;
  this warm-up contributes to the larger first-cycle delta. A1 cycles two and three
  retained 98,000 / 55,876 bytes. Between cycles one and three, code grew 163,936 of
  181,120 bytes (90.5%);
  closure bytes stayed at 220,124. Small history arrays grow toward their existing
  caps; attached DOM growth stays zero. This is code warm-up plus the editor's
  reactive graph, with no accumulating closed-tab closures in these snapshots.
- CSV still renders the existing 1,000-row cap. The remote tips URL still returns 404.


## A2 wrap-up — 13 November 2026

Five runs, 45 successful scenarios and zero failures, using the same Chrome
157.0.8103.51, React revision and synthetic fixture hashes as A1/vanilla.
Tests/build use Node 24.15.0; the benchmark harness uses Node 24.12.0.
Raw samples and diagnostics remain in ignored `bench-out/a2.json` and
`bench-out/profile.*`; raw A2 heap/profile evidence was moved out of `scripts/bench-web`.
Values below are median / p95 under the existing pooled-sample contract.

| Metric | Unit | Vanilla | A1 | A2 |
|---|---|---:|---:|---:|
| cold.real.tree | ms | 526.80 / 725.90 | 495.90 / 718.00 | 573.10 / 625.00 |
| cold.real.idle | ms | 1047.70 / 1254.20 | 1013.00 / 1237.20 | 1087.80 / 1137.40 |
| cold.real.js_transfer | bytes | 160765.00 / 160765.00 | 166781.00 / 166781.00 | 169373.00 / 169373.00 |
| cold.real.heap | bytes | 3126872.00 / 3165368.00 | 3601100.00 / 3610660.00 | 3499356.00 / 3514668.00 |
| cold.real.dom_nodes | nodes | 4064.00 / 4064.00 | 4133.00 / 4133.00 | 4000.00 / 4000.00 |
| cold.synthetic.tree | ms | 509.30 / 1089.70 | 506.90 / 524.40 | 534.20 / 558.10 |
| cold.synthetic.idle | ms | 1033.90 / 1618.30 | 1019.40 / 1039.00 | 1050.10 / 1070.50 |
| cold.synthetic.js_transfer | bytes | 160765.00 / 160765.00 | 166781.00 / 166781.00 | 169373.00 / 169373.00 |
| cold.synthetic.heap | bytes | 3107440.00 / 3112712.00 | 3563904.00 / 3574940.00 | 3489852.00 / 3490152.00 |
| cold.synthetic.dom_nodes | nodes | 4060.00 / 4060.00 | 4059.00 / 4059.00 | 3926.00 / 3926.00 |
| finder.keystroke | ms | 64.20 / 78.50 | 77.30 / 79.20 | 76.80 / 79.20 |
| file.open_50k | ms | 43.90 / 74.50 | 45.90 / 70.60 | 45.60 / 71.30 |
| scroll.frame | ms | 16.70 / 16.80 | 16.70 / 16.80 | 16.70 / 16.70 |
| scroll.frames_over_16_7 | frames | 17.00 / 19.00 | 13.00 / 16.00 | 11.00 / 15.00 |
| scroll.long_tasks | tasks | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| scroll.long_task_total | ms | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| scroll.geometry_misses | checkpoints | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| scroll.content_misses | checkpoints | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| cursor.interaction | ms | 24.00 / 40.00 | 24.00 / 40.00 | 24.00 / 40.00 |
| cursor.interactions_ge_16 | interactions | 300.00 / 300.00 | 300.00 / 300.00 | 300.00 / 300.00 |
| edit.enter_50k | ms | 1647.20 / 1674.60 | 529.30 / 551.30 | 536.00 / 539.20 |
| edit.keystroke | ms | 103.90 / 126.60 | 36.50 / 40.20 | 36.50 / 40.20 |
| edit.interaction | ms | 88.00 / 112.00 | 40.00 / 40.00 | 40.00 / 40.00 |
| edit.interactions_ge_16 | interactions | 200.00 / 200.00 | 200.00 / 200.00 | 200.00 / 200.00 |
| tabs.switch | ms | 31.45 / 36.00 | 30.65 / 35.00 | 30.60 / 34.80 |
| tree.expand_20k | ms | 1224.50 / 1452.70 | 1128.10 / 1164.60 | 1143.70 / 1155.80 |
| tree.reveal_deep | ms | 140.80 / 233.20 | 114.40 / 186.20 | 182.10 / 188.20 |
| search.results | ms | 895.60 / 972.30 | 874.50 / 887.10 | 906.60 / 953.60 |
| preview.markdown_5k | ms | 194.20 / 391.70 | 119.60 / 185.10 | 111.60 / 183.00 |
| preview.csv_20k | ms | 118.70 / 133.60 | 103.90 / 106.00 | 98.50 / 104.20 |
| memory.heap_delta | bytes | 409988.00 / 411328.00 | 602756.00 / 603528.00 | 602836.00 / 681848.00 |
| memory.dom_delta | nodes | 20.00 / 20.00 | 20.00 / 20.00 | 20.00 / 1013.00 |
| memory.attached_delta | elements | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 348.00 |

- Markdown and CSV beat A1: 111.6 / 98.5ms versus 119.6 / 103.9ms.
  The source viewport previously kept painting hidden rows behind previews.
  Its slot window now derives an empty range while covered, retaining the buffer
  for source navigation. Diagnostic preview passes fell from about 112ms to 99ms
  for CSV. Fixed column sizing and native row content visibility did not help
  in paired diagnostic passes and were not retained. Sanitized Markdown is memoized
  by content/path, with a test for unrelated theme and scroll-target changes.
- Source-tab retained heap is effectively unchanged from A1: 602,836 versus
  602,756 bytes; vanilla is 409,988. Four of five A2 samples lie between 602,196
  and 602,976 bytes; one reaches 681,848. Attached element growth remains zero
  and total DOM growth remains 20 nodes. Existing A2 heap diagnostics under
  `bench-out/a2-profile-evidence.json` separate compiled-code warm-up from
  retained viewer data; these are local evidence, not committed raw artifacts.
- Two medians exceed the older A1 table by more than 10%: cold real-tree loading
  and deep reveal. Fresh alternating runs used the exact A1 baseline binary
  (SHA-256 `8765d65dcdcb95120f8df0c4d73613f2e4d38852c5a38c49ed2f9eaa2e086673`).
  Three cold traces measured 524.3 / 498.8ms (A1/A2); script evaluation was
  62.8 / 32.2ms, style recalculation 24.1 / 39.1ms, and layout 12.0 / 18.7ms.
  External font CSS alone took roughly 290–313ms in the middle paired runs.
  Three alternating tree runs measured expansion 1152.5 / 1150.0ms and reveal
  187.8 / 186.9ms. This reproduces the slower reveal boundary in A1 too; it
  does not establish an A2 regression of the size suggested by the older table.
  Raw paired traces remain in `bench-out/a2-cold-*.trace.json` and
  `bench-out/a2-wrap-paired-*-tree.trace.json`. The tree still creates a row
  per file and pays for full-DOM layout; B replaces it.
- The action surface is one flat `editor.actions` object. The tree store's
  `openLink` reveals directories and opens files; components no longer probe an optional
  `followDirectory` service. The wrap-up adds no effects.

Validation: frontend checks, Go build and short Go tests pass. The headless viewer
smoke covers 29 cases with zero console errors; the explain request is mocked and
the known failing remote tips feed is disabled. The editor smoke passes 38 additional cases with no console errors; its
results are recorded separately in the local diagnostic output. The B tree and
shell work is not included in these A2 results.

## B — 13 November 2026

Five runs of all nine scenarios (45 successful pages, zero failures), using the
same M4, Chrome 157.0.8103.51, React revision and synthetic fixture hashes as the
vanilla/A1/A2 baselines. Frontend checks/build use Node 24.15.0 through nvm;
the harness uses Node v26.3.0. Go is 1.27.3. Frontend source is
`0a25f01`. The harness ran against a freshly built binary.
Values below are medians under the existing pooled-sample contract; raw samples,
p95s and binary/fixture hashes are in ignored `bench-out/b.json`.

| Metric | Unit | Vanilla | A1 | A2 | B |
|---|---|---:|---:|---:|---:|
| cold.real.tree | ms | 526.80 | 495.90 | 573.10 | 564.70 |
| cold.real.idle | ms | 1047.70 | 1013.00 | 1087.80 | 1077.40 |
| cold.real.js_transfer | bytes | 160765.00 | 166781.00 | 169373.00 | 168112.00 |
| cold.real.heap | bytes | 3126872.00 | 3601100.00 | 3499356.00 | 4506068.00 |
| cold.real.dom_nodes | nodes | 4064.00 | 4133.00 | 4000.00 | 3880.00 |
| cold.synthetic.tree | ms | 509.30 | 506.90 | 534.20 | 596.30 |
| cold.synthetic.idle | ms | 1033.90 | 1019.40 | 1050.10 | 1110.80 |
| cold.synthetic.js_transfer | bytes | 160765.00 | 166781.00 | 169373.00 | 168112.00 |
| cold.synthetic.heap | bytes | 3107440.00 | 3563904.00 | 3489852.00 | 4374640.00 |
| cold.synthetic.dom_nodes | nodes | 4060.00 | 4059.00 | 3926.00 | 3770.00 |
| finder.keystroke | ms | 64.20 | 77.30 | 76.80 | 45.20 |
| file.open_50k | ms | 43.90 | 45.90 | 45.60 | 41.90 |
| scroll.frame | ms | 16.70 | 16.70 | 16.70 | 16.70 |
| scroll.frames_over_16_7 | frames | 17.00 | 13.00 | 11.00 | 10.00 |
| scroll.long_tasks | tasks | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.long_task_total | ms | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.geometry_misses | checkpoints | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.content_misses | checkpoints | 0.00 | 0.00 | 0.00 | 0.00 |
| cursor.interaction | ms | 24.00 | 24.00 | 24.00 | 32.00 |
| cursor.interactions_ge_16 | interactions | 300.00 | 300.00 | 300.00 | 300.00 |
| edit.enter_50k | ms | 1647.20 | 529.30 | 536.00 | 526.10 |
| edit.keystroke | ms | 103.90 | 36.50 | 36.50 | 35.90 |
| edit.interaction | ms | 88.00 | 40.00 | 40.00 | 40.00 |
| edit.interactions_ge_16 | interactions | 200.00 | 200.00 | 200.00 | 200.00 |
| tabs.switch | ms | 31.45 | 30.65 | 30.60 | 30.05 |
| tree.expand_20k | ms | 1224.50 | 1128.10 | 1143.70 | 79.20 |
| tree.reveal_deep | ms | 140.80 | 114.40 | 182.10 | 44.80 |
| search.results | ms | 895.60 | 874.50 | 906.60 | 875.50 |
| preview.markdown_5k | ms | 194.20 | 119.60 | 111.60 | 102.80 |
| preview.csv_20k | ms | 118.70 | 103.90 | 98.50 | 92.50 |
| memory.heap_delta | bytes | 409988.00 | 602756.00 | 602836.00 | 584628.00 |
| memory.dom_delta | nodes | 20.00 | 20.00 | 20.00 | 0.00 |
| memory.attached_delta | elements | 0.00 | 0.00 | 0.00 | 0.00 |

- The tree now renders a bounded window over a plain cache rather than creating
  20,000 file rows. Expansion is 79.2ms versus A2's 1,143.7ms.
  Three alternating A2/B runs measured 1,149.8 / 80.6ms for expansion and
  99.3 / 52.0ms for deep reveal. The older A1/A2 paired reveal result was
  187.8 / 186.9ms; the new paired run demonstrates improvement without relying
  on that historical timing boundary. Individual A2 reveal samples were
  97.1, 99.3 and 179.4ms; B samples were 54.8, 52.0 and 43.6ms.
- Finder keystrokes are 45.2ms, down from A2's 76.8ms.
  The 40ms debounce and per-result `scrollIntoView` are gone. Queries start
  immediately; keyboard navigation adjusts owned list scrollTop only when the
  selected row is clipped. Workspace search is 875.5ms versus
  A1's 874.5ms and A2's 906.6ms, including debounce and backend scanning.
- Full-run cold synthetic tree readiness is 11.6% above the historical A2 table.
  A fresh three-run alternating comparison of the final binaries measured
  556.1 / 518.7ms for the real tree and 551.4 / 486.6ms for the synthetic tree
  (A2/B). Synthetic individual samples were 452.3, 574.8, 551.4ms for A2 and
  519.9, 462.1, 486.6ms for B. The paired result does not reproduce a B
  regression; cold readiness includes external font CSS and startup variation.
  Resource timings are preserved in b-paired-cold-final.json.
- Cursor Event Timing is 32ms versus the historical A2 24ms. Fresh alternating
  300-keydown passes measured pooled medians 40 / 24ms (A2/B, 900 reported
  interactions each). Dispatch-loop wall medians were 401.1 / 389.2ms.
  Event Timing includes scheduling through the next paint and is quantized to
  8ms; the paired run does not reproduce a B cursor slowdown. Raw events are
  preserved in b-paired-cursor.json.
- **Cold JavaScript heap increases and is retained as an explicit tradeoff.**
  The paired synthetic uncollected heap was 3,489,952 / 4,377,836 bytes (A2/B).
  After forced GC it was 2,424,564 / 3,178,328 bytes: +753,764 bytes, so the
  increase is not just delayed garbage collection. Heap snapshots attribute
  +251,696 bytes to code, +183,908 to objects, +136,960 to arrays and +104,860
  to closures. These account for about 90% of the added JS heap and reflect
  the mounted Solid controls and feature-store/resource graph. There are no
  file-sized startup buffers. Snapshot native self-size fell 1,001,036 bytes;
  CDP embedder heap fell from 5,002,976 to 3,886,248 bytes. These are separate
  measurements, not an RSS total or a claim that the JS increase disappeared.
  The bounded tree avoids full-tree DOM retention; the warmed tab-cycle JS
  delta is 584,628 bytes versus A2's 602,836 bytes. One cycle
  does not establish leak freedom.
- No scroll geometry/content checks failed and no scroll long tasks were recorded.
  CSV retains its existing 1,000-row display cap. The known remote Tips 404 is
  unchanged; smoke runs disable that feed.

Raw evidence remains in ignored `bench-out/`: `b.json`,
`b-status-profiles/` (five CPU profiles, editor/tree timeline traces and a sampled
allocation profile), `b-paired.json`, `b-paired-*-cold.heapsnapshot`,
`b-paired-cold-final.json`, `b-paired-cursor.json` and the smoke/check logs.
Earlier B diagnostic builds are retained separately.

Validation: `npm run check` passes formatting, ESLint, 258 passing tests in 52 files
(plus one existing optional Tips-file skip), and the three production builds.
All six benchmark harness tests pass. `go build ./...` and
`go test -short ./...` pass across 23 packages: 366 passing top-level tests
and 102 passing subtests, with 49 skip events.

Six headless Playwright smoke suites pass 46 UI checks and four single-stream
assertions with zero console/page errors. Coverage includes tree expansion,
collapse and reveal, new file/folder, context menus, PR scope switching, real
commit and push to a throwaway local bare remote, unpushed/commit-file lists,
sync menu, case/word/regex/glob search, both palettes, real TypeScript references,
symbols, calls and definitions, LSP management UI, status metrics, all three
panel widths and visibility across reload, editing/discard, Markdown/image/diff
viewers, PR markers/comments, review navigation, settings and explanation/thread
handoff. PR data/scope and explanation completion are mocked; no external PR or
coding-harness action is performed. Git mutations stay in the throwaway fixture.
The repo smoke also uses the fresh binary against this checkout. Evidence is in
`b-smoke-{tree,git,search,lsp,repo,pr}.log` and `b-smoke-summary.json`.


## C — 13 November 2026

Five runs of all nine scenarios (45 successful pages, zero failures) on the same
M4, Chrome 157.0.8103.51, React revision and synthetic fixture hashes as the
earlier tables. Checks, builds and the harness all use Node 24.15.0 through nvm
(B ran the harness on Node 26.3.0). Go is 1.27.3. Frontend source is `de3d719`:
the page renders entirely in Solid, `index.html` holds only `#root`, and the
legacy layer is gone. Values are medians under the pooled-sample contract; raw
samples, p95s and binary/fixture hashes are in ignored `bench-out/c.json`.

| Metric | Unit | Vanilla | A1 | A2 | B | C |
|---|---|---:|---:|---:|---:|---:|
| cold.real.tree | ms | 526.80 | 495.90 | 573.10 | 564.70 | 547.10 |
| cold.real.idle | ms | 1047.70 | 1013.00 | 1087.80 | 1077.40 | 1050.90 |
| cold.real.js_transfer | bytes | 160765.00 | 166781.00 | 169373.00 | 168112.00 | 158465.00 |
| cold.real.heap | bytes | 3126872.00 | 3601100.00 | 3499356.00 | 4506068.00 | 4277632.00 |
| cold.real.dom_nodes | nodes | 4064.00 | 4133.00 | 4000.00 | 3880.00 | 1588.00 |
| cold.synthetic.tree | ms | 509.30 | 506.90 | 534.20 | 596.30 | 518.70 |
| cold.synthetic.idle | ms | 1033.90 | 1019.40 | 1050.10 | 1110.80 | 1030.60 |
| cold.synthetic.js_transfer | bytes | 160765.00 | 166781.00 | 169373.00 | 168112.00 | 158465.00 |
| cold.synthetic.heap | bytes | 3107440.00 | 3563904.00 | 3489852.00 | 4374640.00 | 5109856.00 |
| cold.synthetic.dom_nodes | nodes | 4060.00 | 4059.00 | 3926.00 | 3770.00 | 1478.00 |
| finder.keystroke | ms | 64.20 | 77.30 | 76.80 | 45.20 | 47.30 |
| file.open_50k | ms | 43.90 | 45.90 | 45.60 | 41.90 | 45.50 |
| scroll.frame | ms | 16.70 | 16.70 | 16.70 | 16.70 | 16.70 |
| scroll.frames_over_16_7 | frames | 17.00 | 13.00 | 11.00 | 10.00 | 10.00 |
| scroll.long_tasks | tasks | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.long_task_total | ms | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.geometry_misses | checkpoints | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| scroll.content_misses | checkpoints | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| cursor.interaction | ms | 24.00 | 24.00 | 24.00 | 32.00 | 32.00 |
| cursor.interactions_ge_16 | interactions | 300.00 | 300.00 | 300.00 | 300.00 | 300.00 |
| edit.enter_50k | ms | 1647.20 | 529.30 | 536.00 | 526.10 | 547.40 |
| edit.keystroke | ms | 103.90 | 36.50 | 36.50 | 35.90 | 38.50 |
| edit.interaction | ms | 88.00 | 40.00 | 40.00 | 40.00 | 40.00 |
| edit.interactions_ge_16 | interactions | 200.00 | 200.00 | 200.00 | 200.00 | 200.00 |
| tabs.switch | ms | 31.45 | 30.65 | 30.60 | 30.05 | 31.70 |
| tree.expand_20k | ms | 1224.50 | 1128.10 | 1143.70 | 79.20 | 79.30 |
| tree.reveal_deep | ms | 140.80 | 114.40 | 182.10 | 44.80 | 45.70 |
| search.results | ms | 895.60 | 874.50 | 906.60 | 875.50 | 908.20 |
| preview.markdown_5k | ms | 194.20 | 119.60 | 111.60 | 102.80 | 117.80 |
| preview.csv_20k | ms | 118.70 | 103.90 | 98.50 | 92.50 | 97.20 |
| memory.heap_delta | bytes | 409988.00 | 602756.00 | 602836.00 | 584628.00 | 539504.00 |
| memory.dom_delta | nodes | 20.00 | 20.00 | 20.00 | 0.00 | 0.00 |
| memory.attached_delta | elements | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

Paired runs rebuilt the vanilla (`3e18f55`), B (`0a25f01`) and C (`de3d719`)
binaries from source and ran six rotated rounds of cold real and synthetic
loads, the Markdown/CSV previews and the 300-keydown cursor pass on one
browser. Each cold page was also measured after a forced GC. Results are in
`bench-out/c-paired.json`.

| Paired metric | Unit | Vanilla | B | C |
|---|---|---:|---:|---:|
| cold.real.tree | ms | 547.3 | 831.9 | 577.8 |
| cold.synthetic.tree | ms | 551.9 | 528.2 | 492.2 |
| cold.real.heap after GC | bytes | 2015148 | 3233396 | 3368538 |
| cold.synthetic.heap after GC | bytes | 2014232 | 3179560 | 3324232 |
| cold.synthetic.dom_nodes after GC | nodes | 3818 | 3479 | 1200 |
| preview.markdown_5k | ms | 109.6 | 144.8 | 145.1 |
| preview.csv_20k | ms | 108.9 | 97.6 | 98.1 |
| cursor.interaction | ms | 32 | 32 | 24 |
| cursor dispatch wall | ms | 521.4 | 404.0 | 376.6 |

- Cold synthetic tree readiness is 518.7ms, 1.8% above vanilla's 509.3ms and
  below B's 596.3ms. The paired synthetic median is 492.2ms against vanilla's
  551.9ms. The real-corpus tree is 547.1ms (+3.9% on the table, +5.6% paired);
  its paired samples include one-second outliers in every build, so the
  medians move with startup and font loading rather than the frontend.
- **Cold JavaScript heap stays above vanilla and is kept as a tradeoff.** After
  forced GC the synthetic heap is 3,324,232 bytes against vanilla's 2,014,232
  (+65%) and B's 3,179,560 (+4.6%, +144,672 bytes). Snapshots of the same
  three builds attribute the C-over-vanilla JS increase to compiled code
  (+483,880 bytes), objects (+271,852), arrays (+202,640) and closures
  (+147,016): the Solid runtime, component templates and the reactive graph
  for the mounted shell. The C-over-B increase is the shell moving from static
  HTML into components (+48,660 objects, +42,268 arrays, +31,252 closures),
  while compiled code fell 41,004 bytes. The same move removes closed dialogs,
  the hidden review view, PR bar and side-panel contents from the cold DOM:
  1,200 nodes against vanilla's 3,818. Snapshot native memory is 1,275,904
  bytes below vanilla and 629,838 below B, and the CDP embedder heap is
  3,430,624 bytes against vanilla's 5,056,408 and B's 4,215,264. These are
  separate measurements, not an RSS total. The uncollected cold heap in the
  table (+16.8% over B on the synthetic corpus, −5.1% on the real one) is
  garbage that forced GC removes.
- Markdown preview is 117.8ms in the table (B 102.8ms, vanilla 194.2ms).
  Samples are bimodal in every build (C: 100.7–208.2ms); the paired medians
  are 144.8 / 145.1ms (B/C), so the table difference is not reproduced.
- Cursor Event Timing is 32ms in the table, as in B. The paired pass measures
  24ms for C against 32ms for vanilla and B, and the dispatch loop is the
  fastest of the three. Event Timing is quantized to 8ms.
- Workspace search is 908.2ms (vanilla 895.6ms), within the backend scan and
  debounce variation seen in every table. Tree expansion (79.3ms) and deep
  reveal (45.7ms) hold B's improvement.
- Bundles against vanilla, minified bytes (gzip): `app.js` 430,629 (130,339)
  versus 433,670 (134,402); `workbench.js` 53,411 (18,973) versus 22,295
  (8,165); `holding.js` 17,327 (6,952) versus 2,749 (1,460). The workbench and
  holding pages now carry the Solid runtime and shared components.

Raw evidence is in ignored `bench-out/`: `c.json`, `c/` (CPU profiles and
traces), `c-run.log`, `c-paired.json`, `c-paired-heap.json`,
`c-paired-*-cold.heapsnapshot` and `c-go-test.json`.

Validation: `npm run check` passes formatting, ESLint, 329 tests in 66 files
and the three production builds; `npm run typecheck` passes in 0.2–0.4s.
`go build ./...` and `go test -short ./...` pass across 23 packages: 366
passing top-level tests and 102 passing subtests, with 49 skips. Five headless
Playwright smoke suites against a fresh binary pass 36 UI checks with zero
console or page errors. They cover the shell structure, welcome page and
`?path=` start-up, header toggles and body classes, palette copy and select-all,
the review overview, pipeline, follow-ups and run controls, PR bar, comments,
diff markers, verdict and merge with mocked PR data, the settings dialog and
JSON view, and global and editor shortcuts. The workspace is a throwaway
repository; review runs and PR calls are mocked.
