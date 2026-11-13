# Frontend benchmarks

## Reproduce

```sh
npm ci
npm run build
go build -o faah .
npm run test:bench-web
npm run bench:web -- --runs 5 --json bench-out/frontend.json --out bench-out/frontend
```

The harness builds nothing. See the [harness guide](../../scripts/bench-web/README.md)
for options, timing boundaries, and statistics. UI selectors live in
[selectors.js](../../scripts/bench-web/selectors.js). To compare two runs, supply
`--baseline PATH` explicitly. Keep raw samples and profiles in the gitignored
`bench-out/` directory.

## Current results

Measured on 2026-11-13 from `28d327c` (five runs, zero failures), on an Apple M4 (10 logical CPUs, 16 GiB RAM), Darwin arm64, Chrome
157.0.8103.51 headless, Node 24.15.0. The real corpus is React at
`df6aa4ec76cff5b3adde531c6fe8c36099e0469b`. The deterministic synthetic corpus
contains 50k source lines, 5k Markdown lines, 20k CSV rows, 20k source files and
20 tab fixtures. Servers are already indexed; each scenario uses a fresh browser
context at 1440×900 with empty HTTP/storage caches. Agents, LSP, updates and
telemetry are disabled; Git stays enabled.

Action samples are pooled across runs. Two-rAF timings include a paint opportunity;
Event Timing is quantized and includes presentation. Cold idle includes a fixed
500 ms quiet window. Heap in this table is not forced-GC retained heap. The JSON
records source and binary hashes, corpus identity and browser version.

| Metric | Unit | Median | p95 |
|---|---|---:|---:|
| cold.real.tree | ms | 177.00 | 233.60 |
| cold.real.idle | ms | 707.10 | 765.40 |
| cold.real.js_transfer | bytes | 182811.00 | 182811.00 |
| cold.real.heap | bytes | 4707828.00 | 4737544.00 |
| cold.real.dom_nodes | nodes | 1800.00 | 1800.00 |
| cold.synthetic.tree | ms | 144.60 | 145.80 |
| cold.synthetic.idle | ms | 673.40 | 673.80 |
| cold.synthetic.js_transfer | bytes | 182811.00 | 182811.00 |
| cold.synthetic.heap | bytes | 4366684.00 | 4389304.00 |
| cold.synthetic.dom_nodes | nodes | 1681.00 | 1681.00 |
| finder.keystroke | ms | 45.80 | 97.20 |
| file.open_50k | ms | 44.00 | 89.60 |
| scroll.frame | ms | 16.70 | 33.40 |
| scroll.frames_over_16_7 | frames | 11.00 | 240.00 |
| scroll.long_tasks | tasks | 0.00 | 0.00 |
| scroll.long_task_total | ms | 0.00 | 0.00 |
| scroll.geometry_misses | checkpoints | 0.00 | 0.00 |
| scroll.content_misses | checkpoints | 0.00 | 0.00 |
| cursor.interaction | ms | 24.00 | 40.00 |
| cursor.interactions_ge_16 | interactions | 281.00 | 298.00 |
| edit.enter_50k | ms | 549.20 | 564.70 |
| edit.keystroke | ms | 35.50 | 80.50 |
| edit.interaction | ms | 40.00 | 56.00 |
| edit.interactions_ge_16 | interactions | 200.00 | 200.00 |
| tabs.switch | ms | 31.85 | 64.10 |
| tree.expand_20k | ms | 80.40 | 127.40 |
| tree.reveal_deep | ms | 49.30 | 86.00 |
| search.results | ms | 891.70 | 1092.10 |
| preview.markdown_5k | ms | 113.50 | 190.40 |
| preview.csv_20k | ms | 101.30 | 105.50 |
| memory.heap_delta | bytes | 552216.00 | 590200.00 |
| memory.dom_delta | nodes | 0.00 | 0.00 |
| memory.attached_delta | elements | 0.00 | 0.00 |

## Known costs

- Fonts are embedded as the same JetBrains Mono WOFF2 subsets and faces used by
  the UI. Startup no longer waits for a remote font stylesheet. The editor's
  measured character width and line height remain 8.1 px and 21 px at defaults.
- Entering edit mode in a 50k-line file still lays out a full native textarea.
  Profiling attributed roughly 438 ms to layout. The gutter is virtualized;
  the native editing surface is not. Incremental line starts reduce input CPU
  work without replacing native editing behavior.
- Workspace search is dominated by the server opening and reading candidate
  files. A measured request spent about 681 ms awaiting its response, alongside
  the 160 ms input debounce. A bounded content cache or content index would need
  separate design and correctness work.
- Cold retained JS heap is about 3.4 MB with inspector instrumentation. Compiled
  code and the reactive/component graph account for most of the increase over
  a smaller implementation; proxy wrappers themselves are small. Opening and
  closing tabs warms code: decreasing growth over repeated cycles and stable
  DOM counts do not prove leak freedom. Inspect retaining paths before changing
  caches or bounded navigation history.
- The five-run scroll result includes one uniformly paced 33.3 ms run (240/240
  intervals over budget). Three subsequent alternating runs of each binary
  reproduced the same 33.3 ms cadence in both builds, with zero long tasks or
  geometry/content misses. The cadence change is environmental; retain the
  observed p95 rather than dropping the outlier.
- Scroll intervals of 16.8 ms cross the strict 16.7 ms counter without implying
  a missed 33 ms display frame. Keep geometry/content checks and long-task counts
  alongside that threshold.
