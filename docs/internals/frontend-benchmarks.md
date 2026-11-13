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

Measured on an Apple M4 (10 logical CPUs, 16 GiB RAM), Darwin arm64, Chrome
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
| cold.real.tree | ms | 852.10 | 1321.90 |
| cold.real.idle | ms | 1368.00 | 1837.60 |
| cold.real.js_transfer | bytes | 181406.00 | 181406.00 |
| cold.real.heap | bytes | 4716088.00 | 4716300.00 |
| cold.real.dom_nodes | nodes | 1804.00 | 1804.00 |
| cold.synthetic.tree | ms | 597.70 | 892.20 |
| cold.synthetic.idle | ms | 1112.90 | 1402.50 |
| cold.synthetic.js_transfer | bytes | 181406.00 | 181406.00 |
| cold.synthetic.heap | bytes | 4412248.00 | 4432936.00 |
| cold.synthetic.dom_nodes | nodes | 1685.00 | 1685.00 |
| finder.keystroke | ms | 46.20 | 48.90 |
| file.open_50k | ms | 45.10 | 59.60 |
| scroll.frame | ms | 16.70 | 16.70 |
| scroll.frames_over_16_7 | frames | 6.00 | 10.00 |
| scroll.long_tasks | tasks | 0.00 | 0.00 |
| scroll.long_task_total | ms | 0.00 | 0.00 |
| scroll.geometry_misses | checkpoints | 0.00 | 0.00 |
| scroll.content_misses | checkpoints | 0.00 | 0.00 |
| cursor.interaction | ms | 24.00 | 48.00 |
| cursor.interactions_ge_16 | interactions | 298.00 | 300.00 |
| edit.enter_50k | ms | 541.70 | 545.10 |
| edit.keystroke | ms | 36.30 | 40.00 |
| edit.interaction | ms | 40.00 | 40.00 |
| edit.interactions_ge_16 | interactions | 200.00 | 200.00 |
| tabs.switch | ms | 30.05 | 35.00 |
| tree.expand_20k | ms | 78.40 | 78.80 |
| tree.reveal_deep | ms | 49.60 | 54.90 |
| search.results | ms | 877.80 | 1043.80 |
| preview.markdown_5k | ms | 104.20 | 179.40 |
| preview.csv_20k | ms | 98.30 | 101.80 |
| memory.heap_delta | bytes | 548652.00 | 555996.00 |
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
- Scroll intervals of 16.8 ms cross the strict 16.7 ms counter without implying
  a missed 33 ms display frame. Keep geometry/content checks and long-task counts
  alongside that threshold.
