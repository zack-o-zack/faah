# Go baseline

Backend source: c32fe4e85b985c20d41560ab7c659e4868646e21. Binary: 16.13 MiB.

Two sequential full runs. Headline values below use run A. Startup is median index-ready time over five launches; request values are p50 for find.0, literal common search, and the large-file first window. RSS is process-tree MiB. SSE is save / external edit. Rates use the mixed workload at C=8.

| Repository | Startup ready ms | Find / search / file ms | SSE save / external ms | C=8 req/s | RSS ready / peak / idle MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| flask | 186.83 | 0.10 / 2.65 / 0.33 | 120.50 / 929.99 | 252.46 | 31.4 / 1276.2 / 34.8 |
| redis | 697.36 | 0.20 / 6.80 / 0.47 | 136.35 / 920.77 | 177.03 | 30.0 / 1118.8 / 39.0 |
| react | 1601.53 | 0.28 / 6.79 / 0.39 | 147.36 / 903.72 | 213.38 | 32.3 / 1366.7 / 103.3 |
| kubernetes | 9021.38 | 0.74 / 24.67 / 0.29 | 401.86 / 1047.31 | 103.50 | 45.9 / 882.2 / 16.2 |

## Observations

Metadata is substantially slower than fuzzy find in this baseline. Metadata includes forge credential resolution (which can invoke `gh auth token`) and process metrics; it is not a pure router/JSON measurement. Under four regex-search clients, its tail latency rises further. These are endpoint totals, not a profile of one subsystem.

The large transient RSS peaks count the full descendant process tree and can include shared pages in more than one process. Go also explicitly scavenges idle render memory and invokes `debug.FreeOSMemory`; much lower idle RSS is expected. These figures should not be interpreted as unique heap allocation.

The Go executable was built with CGO_ENABLED=0, -trimpath and -ldflags="-s -w" after npm run build. Its embedded VCS revision is c32fe4e; its dirty marker is caused by the added benchmark directory. Existing tracked backend/frontend files were not edited.

The separate Go microbenchmark baseline covers 28 names, three samples each: [parsed JSON](go-micro-c32fe4e.json), [raw output](go-micro-c32fe4e.txt). Inputs and methodology are documented in [the harness README](../README.md).

## Validation

- flask: table skipped (No tracked CSV)
- flask: response statuses/counts and load errors passed
- redis: table skipped (No tracked CSV)
- redis: response statuses/counts and load errors passed
- react: table skipped (No tracked CSV)
- react: response statuses/counts and load errors passed
- kubernetes: response statuses/counts and load errors passed
- flask: table skipped (No tracked CSV)
- flask: response statuses/counts and load errors passed
- redis: table skipped (No tracked CSV)
- redis: response statuses/counts and load errors passed
- react: table skipped (No tracked CSV)
- react: response statuses/counts and load errors passed
- kubernetes: response statuses/counts and load errors passed

## Run-to-run variation for every metric

Delta is `(B/A − 1) × 100%`. With the same implementation, these differences are observed noise and state effects, not evidence of an implementation speedup. Small sub-millisecond metrics can show large percentages. p99 from 30 samples is the maximum; interpret it with care. Truncated common searches can return different capped counts because concurrent search workers race to the cap. The raw request counts and byte sizes make that work visible. A zero denominator is shown as n/a.

| Metric | Go-A | Go-B | Delta % (b/a − 1) | Better |
| --- | ---: | ---: | ---: | --- |
| binary.size | 16.13 MiB | 16.13 MiB | 0.00 | equal |
| flask.startup.first.min | 100.274 ms | 103.904 ms | 3.62 | Go-A |
| flask.startup.first.p50 | 101.787 ms | 105.785 ms | 3.93 | Go-A |
| flask.startup.first.p95 | 306.550 ms | 116.687 ms | -61.94 | Go-B |
| flask.startup.first.p99 | 306.550 ms | 116.687 ms | -61.94 | Go-B |
| flask.startup.first.mean | 156.948 ms | 108.504 ms | -30.87 | Go-B |
| flask.startup.ready.min | 183.440 ms | 188.035 ms | 2.50 | Go-A |
| flask.startup.ready.p50 | 186.833 ms | 197.017 ms | 5.45 | Go-A |
| flask.startup.ready.p95 | 392.359 ms | 202.585 ms | -48.37 | Go-B |
| flask.startup.ready.p99 | 392.359 ms | 202.585 ms | -48.37 | Go-B |
| flask.startup.ready.mean | 241.030 ms | 195.951 ms | -18.70 | Go-B |
| flask.meta.min | 62.186 ms | 63.653 ms | 2.36 | Go-A |
| flask.meta.p50 | 67.439 ms | 71.861 ms | 6.56 | Go-A |
| flask.meta.p95 | 87.428 ms | 94.048 ms | 7.57 | Go-A |
| flask.meta.p99 | 148.428 ms | 99.498 ms | -32.97 | Go-B |
| flask.meta.mean | 71.656 ms | 73.479 ms | 2.54 | Go-A |
| flask.tree.root.min | 0.074 ms | 0.074 ms | 0.40 | Go-A |
| flask.tree.root.p50 | 0.081 ms | 0.089 ms | 10.04 | Go-A |
| flask.tree.root.p95 | 0.100 ms | 0.208 ms | 108.01 | Go-A |
| flask.tree.root.p99 | 0.162 ms | 0.376 ms | 132.91 | Go-A |
| flask.tree.root.mean | 0.085 ms | 0.106 ms | 25.48 | Go-A |
| flask.tree.deep.min | 0.064 ms | 0.071 ms | 9.85 | Go-A |
| flask.tree.deep.p50 | 0.080 ms | 0.082 ms | 2.60 | Go-A |
| flask.tree.deep.p95 | 0.108 ms | 0.097 ms | -10.19 | Go-B |
| flask.tree.deep.p99 | 0.111 ms | 0.106 ms | -4.91 | Go-B |
| flask.tree.deep.mean | 0.080 ms | 0.083 ms | 3.32 | Go-A |
| flask.find.0.min | 0.089 ms | 0.111 ms | 24.61 | Go-A |
| flask.find.0.p50 | 0.101 ms | 0.118 ms | 16.43 | Go-A |
| flask.find.0.p95 | 0.148 ms | 0.140 ms | -5.81 | Go-B |
| flask.find.0.p99 | 0.349 ms | 0.145 ms | -58.30 | Go-B |
| flask.find.0.mean | 0.112 ms | 0.121 ms | 7.58 | Go-A |
| flask.find.1.min | 0.067 ms | 0.084 ms | 25.41 | Go-A |
| flask.find.1.p50 | 0.075 ms | 0.091 ms | 21.47 | Go-A |
| flask.find.1.p95 | 0.090 ms | 0.104 ms | 15.80 | Go-A |
| flask.find.1.p99 | 0.091 ms | 0.111 ms | 22.00 | Go-A |
| flask.find.1.mean | 0.076 ms | 0.093 ms | 21.55 | Go-A |
| flask.find.2.min | 0.060 ms | 0.071 ms | 18.94 | Go-A |
| flask.find.2.p50 | 0.068 ms | 0.084 ms | 23.86 | Go-A |
| flask.find.2.p95 | 0.077 ms | 0.099 ms | 28.87 | Go-A |
| flask.find.2.p99 | 0.094 ms | 0.099 ms | 5.41 | Go-A |
| flask.find.2.mean | 0.069 ms | 0.085 ms | 24.03 | Go-A |
| flask.find.3.min | 0.058 ms | 0.060 ms | 3.17 | Go-A |
| flask.find.3.p50 | 0.066 ms | 0.070 ms | 5.21 | Go-A |
| flask.find.3.p95 | 0.089 ms | 0.094 ms | 5.47 | Go-A |
| flask.find.3.p99 | 0.365 ms | 0.115 ms | -68.34 | Go-B |
| flask.find.3.mean | 0.076 ms | 0.073 ms | -4.39 | Go-B |
| flask.search.common.min | 2.378 ms | 2.501 ms | 5.19 | Go-A |
| flask.search.common.p50 | 2.651 ms | 2.694 ms | 1.60 | Go-A |
| flask.search.common.p95 | 2.879 ms | 2.891 ms | 0.41 | Go-A |
| flask.search.common.p99 | 4.922 ms | 3.419 ms | -30.52 | Go-B |
| flask.search.common.mean | 2.722 ms | 2.722 ms | 0.01 | Go-A |
| flask.search.rare.min | 1.639 ms | 1.846 ms | 12.63 | Go-A |
| flask.search.rare.p50 | 1.978 ms | 1.988 ms | 0.52 | Go-A |
| flask.search.rare.p95 | 2.126 ms | 2.205 ms | 3.71 | Go-A |
| flask.search.rare.p99 | 2.208 ms | 2.214 ms | 0.25 | Go-A |
| flask.search.rare.mean | 1.959 ms | 1.989 ms | 1.55 | Go-A |
| flask.search.regex.min | 8.112 ms | 8.853 ms | 9.13 | Go-A |
| flask.search.regex.p50 | 8.742 ms | 9.666 ms | 10.58 | Go-A |
| flask.search.regex.p95 | 9.450 ms | 10.867 ms | 15.00 | Go-A |
| flask.search.regex.p99 | 9.605 ms | 12.358 ms | 28.67 | Go-A |
| flask.search.regex.mean | 8.767 ms | 9.851 ms | 12.37 | Go-A |
| flask.search.case-word.min | 3.749 ms | 4.242 ms | 13.17 | Go-A |
| flask.search.case-word.p50 | 4.240 ms | 4.947 ms | 16.66 | Go-A |
| flask.search.case-word.p95 | 4.857 ms | 5.499 ms | 13.21 | Go-A |
| flask.search.case-word.p99 | 4.861 ms | 5.694 ms | 17.14 | Go-A |
| flask.search.case-word.mean | 4.233 ms | 4.967 ms | 17.33 | Go-A |
| flask.search.no-hit.min | 1.727 ms | 1.853 ms | 7.25 | Go-A |
| flask.search.no-hit.p50 | 1.904 ms | 2.121 ms | 11.39 | Go-A |
| flask.search.no-hit.p95 | 2.033 ms | 2.421 ms | 19.10 | Go-A |
| flask.search.no-hit.p99 | 2.064 ms | 2.424 ms | 17.42 | Go-A |
| flask.search.no-hit.mean | 1.889 ms | 2.131 ms | 12.78 | Go-A |
| flask.file.large.min | 0.296 ms | 0.356 ms | 20.19 | Go-A |
| flask.file.large.p50 | 0.333 ms | 0.411 ms | 23.48 | Go-A |
| flask.file.large.p95 | 0.429 ms | 0.536 ms | 24.91 | Go-A |
| flask.file.large.p99 | 0.455 ms | 0.558 ms | 22.67 | Go-A |
| flask.file.large.mean | 0.344 ms | 0.430 ms | 25.02 | Go-A |
| flask.file.typical.min | 0.152 ms | 0.171 ms | 12.23 | Go-A |
| flask.file.typical.p50 | 0.160 ms | 0.184 ms | 14.99 | Go-A |
| flask.file.typical.p95 | 0.204 ms | 0.232 ms | 13.79 | Go-A |
| flask.file.typical.p99 | 0.207 ms | 0.247 ms | 19.11 | Go-A |
| flask.file.typical.mean | 0.165 ms | 0.189 ms | 14.08 | Go-A |
| flask.file.scroll.min | 0.178 ms | 0.211 ms | 18.16 | Go-A |
| flask.file.scroll.p50 | 0.190 ms | 0.222 ms | 16.88 | Go-A |
| flask.file.scroll.p95 | 0.210 ms | 0.287 ms | 36.75 | Go-A |
| flask.file.scroll.p99 | 0.233 ms | 0.344 ms | 47.82 | Go-A |
| flask.file.scroll.mean | 0.194 ms | 0.232 ms | 19.96 | Go-A |
| flask.markdown.min | 0.215 ms | 0.270 ms | 26.02 | Go-A |
| flask.markdown.p50 | 0.235 ms | 0.297 ms | 26.48 | Go-A |
| flask.markdown.p95 | 0.381 ms | 0.626 ms | 64.31 | Go-A |
| flask.markdown.p99 | 0.417 ms | 0.639 ms | 53.22 | Go-A |
| flask.markdown.mean | 0.250 ms | 0.323 ms | 29.46 | Go-A |
| flask.outline.min | 0.196 ms | 0.250 ms | 27.30 | Go-A |
| flask.outline.p50 | 0.213 ms | 0.260 ms | 22.09 | Go-A |
| flask.outline.p95 | 0.238 ms | 0.286 ms | 20.17 | Go-A |
| flask.outline.p99 | 0.251 ms | 0.291 ms | 15.74 | Go-A |
| flask.outline.mean | 0.215 ms | 0.263 ms | 22.36 | Go-A |
| flask.def.min | 3.053 ms | 3.340 ms | 9.40 | Go-A |
| flask.def.p50 | 3.516 ms | 3.903 ms | 11.02 | Go-A |
| flask.def.p95 | 4.948 ms | 4.395 ms | -11.18 | Go-B |
| flask.def.p99 | 5.294 ms | 5.144 ms | -2.84 | Go-B |
| flask.def.mean | 3.670 ms | 3.915 ms | 6.67 | Go-A |
| flask.git.refresh.min | 64.207 ms | 66.176 ms | 3.07 | Go-A |
| flask.git.refresh.p50 | 66.872 ms | 69.397 ms | 3.78 | Go-A |
| flask.git.refresh.p95 | 74.653 ms | 78.733 ms | 5.47 | Go-A |
| flask.git.refresh.p99 | 77.118 ms | 80.891 ms | 4.89 | Go-A |
| flask.git.refresh.mean | 67.735 ms | 70.629 ms | 4.27 | Go-A |
| flask.diff.min | 12.008 ms | 12.521 ms | 4.27 | Go-A |
| flask.diff.p50 | 12.624 ms | 12.964 ms | 2.69 | Go-A |
| flask.diff.p95 | 13.419 ms | 13.552 ms | 0.98 | Go-A |
| flask.diff.p99 | 17.078 ms | 13.653 ms | -20.05 | Go-B |
| flask.diff.mean | 12.834 ms | 13.007 ms | 1.34 | Go-A |
| flask.gutter.min | 9.590 ms | 10.065 ms | 4.96 | Go-A |
| flask.gutter.p50 | 9.900 ms | 10.403 ms | 5.07 | Go-A |
| flask.gutter.p95 | 10.536 ms | 12.454 ms | 18.21 | Go-A |
| flask.gutter.p99 | 10.552 ms | 14.306 ms | 35.58 | Go-A |
| flask.gutter.mean | 9.960 ms | 10.749 ms | 7.92 | Go-A |
| flask.file.cold | 33.538 ms | 31.797 ms | -5.19 | Go-B |
| flask.file.warm | 0.569 ms | 0.531 ms | -6.57 | Go-B |
| flask.sse.save.min | 70.804 ms | 69.579 ms | -1.73 | Go-B |
| flask.sse.save.p50 | 120.495 ms | 122.511 ms | 1.67 | Go-A |
| flask.sse.save.p95 | 164.912 ms | 135.077 ms | -18.09 | Go-B |
| flask.sse.save.p99 | 164.912 ms | 135.077 ms | -18.09 | Go-B |
| flask.sse.save.mean | 114.735 ms | 115.444 ms | 0.62 | Go-A |
| flask.sse.save.timeouts | 0.000 count | 0.000 count | n/a | equal |
| flask.sse.external.min | 71.261 ms | 598.628 ms | 740.05 | Go-A |
| flask.sse.external.p50 | 929.985 ms | 924.639 ms | -0.57 | Go-B |
| flask.sse.external.p95 | 1059.765 ms | 942.197 ms | -11.09 | Go-B |
| flask.sse.external.p99 | 1059.765 ms | 942.197 ms | -11.09 | Go-B |
| flask.sse.external.mean | 783.498 ms | 894.998 ms | 14.23 | Go-A |
| flask.sse.external.timeouts | 0.000 count | 0.000 count | n/a | equal |
| flask.throughput.C1 | 71.624 req/s | 69.409 req/s | -3.09 | Go-A |
| flask.throughput.C1.errors | 0.000 count | 0.000 count | n/a | equal |
| flask.throughput.C1.min | 0.123 ms | 0.142 ms | 15.02 | Go-A |
| flask.throughput.C1.p50 | 0.609 ms | 0.610 ms | 0.18 | Go-A |
| flask.throughput.C1.p95 | 65.884 ms | 66.318 ms | 0.66 | Go-A |
| flask.throughput.C1.p99 | 69.109 ms | 72.696 ms | 5.19 | Go-A |
| flask.throughput.C1.mean | 13.889 ms | 14.334 ms | 3.20 | Go-A |
| flask.throughput.C8 | 252.465 req/s | 212.452 req/s | -15.85 | Go-A |
| flask.throughput.C8.errors | 0.000 count | 0.000 count | n/a | equal |
| flask.throughput.C8.min | 0.172 ms | 0.197 ms | 14.42 | Go-A |
| flask.throughput.C8.p50 | 2.692 ms | 3.216 ms | 19.48 | Go-A |
| flask.throughput.C8.p95 | 147.145 ms | 179.673 ms | 22.11 | Go-A |
| flask.throughput.C8.p99 | 164.097 ms | 214.842 ms | 30.92 | Go-A |
| flask.throughput.C8.mean | 31.390 ms | 37.356 ms | 19.00 | Go-A |
| flask.throughput.C32 | 241.178 req/s | 209.144 req/s | -13.28 | Go-A |
| flask.throughput.C32.errors | 0.000 count | 0.000 count | n/a | equal |
| flask.throughput.C32.min | 0.357 ms | 0.369 ms | 3.53 | Go-A |
| flask.throughput.C32.p50 | 21.352 ms | 28.723 ms | 34.52 | Go-A |
| flask.throughput.C32.p95 | 639.802 ms | 719.513 ms | 12.46 | Go-A |
| flask.throughput.C32.p99 | 758.816 ms | 858.903 ms | 13.19 | Go-A |
| flask.throughput.C32.mean | 130.131 ms | 150.232 ms | 15.45 | Go-A |
| flask.under-load.meta.min | 158.090 ms | 168.214 ms | 6.40 | Go-A |
| flask.under-load.meta.p50 | 199.941 ms | 228.068 ms | 14.07 | Go-A |
| flask.under-load.meta.p95 | 254.173 ms | 309.139 ms | 21.63 | Go-A |
| flask.under-load.meta.p99 | 280.985 ms | 403.134 ms | 43.47 | Go-A |
| flask.under-load.meta.mean | 204.734 ms | 233.927 ms | 14.26 | Go-A |
| flask.rss.readyBytes | 31.38 MiB | 27.95 MiB | -10.91 | Go-B |
| flask.rss.peakBytes | 1276.20 MiB | 1110.20 MiB | -13.01 | Go-B |
| flask.rss.idleBytes | 34.83 MiB | 28.61 MiB | -17.86 | Go-B |
| redis.startup.first.min | 106.308 ms | 107.309 ms | 0.94 | Go-A |
| redis.startup.first.p50 | 120.568 ms | 107.750 ms | -10.63 | Go-B |
| redis.startup.first.p95 | 350.022 ms | 296.430 ms | -15.31 | Go-B |
| redis.startup.first.p99 | 350.022 ms | 296.430 ms | -15.31 | Go-B |
| redis.startup.first.mean | 163.771 ms | 145.663 ms | -11.06 | Go-B |
| redis.startup.ready.min | 635.248 ms | 615.624 ms | -3.09 | Go-B |
| redis.startup.ready.p50 | 697.359 ms | 623.072 ms | -10.65 | Go-B |
| redis.startup.ready.p95 | 710.485 ms | 687.444 ms | -3.24 | Go-B |
| redis.startup.ready.p99 | 710.485 ms | 687.444 ms | -3.24 | Go-B |
| redis.startup.ready.mean | 685.045 ms | 635.689 ms | -7.20 | Go-B |
| redis.meta.min | 76.809 ms | 63.321 ms | -17.56 | Go-B |
| redis.meta.p50 | 79.914 ms | 64.950 ms | -18.72 | Go-B |
| redis.meta.p95 | 89.977 ms | 73.055 ms | -18.81 | Go-B |
| redis.meta.p99 | 100.110 ms | 78.653 ms | -21.43 | Go-B |
| redis.meta.mean | 81.629 ms | 65.852 ms | -19.33 | Go-B |
| redis.tree.root.min | 0.082 ms | 0.076 ms | -6.72 | Go-B |
| redis.tree.root.p50 | 0.090 ms | 0.085 ms | -5.40 | Go-B |
| redis.tree.root.p95 | 0.122 ms | 0.114 ms | -6.63 | Go-B |
| redis.tree.root.p99 | 0.163 ms | 0.172 ms | 5.38 | Go-A |
| redis.tree.root.mean | 0.095 ms | 0.091 ms | -4.68 | Go-B |
| redis.tree.deep.min | 0.159 ms | 0.145 ms | -9.23 | Go-B |
| redis.tree.deep.p50 | 0.171 ms | 0.156 ms | -9.15 | Go-B |
| redis.tree.deep.p95 | 0.217 ms | 0.178 ms | -17.87 | Go-B |
| redis.tree.deep.p99 | 0.219 ms | 0.201 ms | -7.86 | Go-B |
| redis.tree.deep.mean | 0.178 ms | 0.157 ms | -11.81 | Go-B |
| redis.find.0.min | 0.181 ms | 0.161 ms | -11.37 | Go-B |
| redis.find.0.p50 | 0.200 ms | 0.176 ms | -11.92 | Go-B |
| redis.find.0.p95 | 0.256 ms | 0.252 ms | -1.55 | Go-B |
| redis.find.0.p99 | 0.595 ms | 0.344 ms | -42.24 | Go-B |
| redis.find.0.mean | 0.222 ms | 0.186 ms | -16.46 | Go-B |
| redis.find.1.min | 0.123 ms | 0.107 ms | -12.93 | Go-B |
| redis.find.1.p50 | 0.142 ms | 0.120 ms | -15.70 | Go-B |
| redis.find.1.p95 | 0.198 ms | 0.139 ms | -30.02 | Go-B |
| redis.find.1.p99 | 0.407 ms | 0.142 ms | -65.24 | Go-B |
| redis.find.1.mean | 0.154 ms | 0.122 ms | -21.03 | Go-B |
| redis.find.2.min | 0.119 ms | 0.113 ms | -5.53 | Go-B |
| redis.find.2.p50 | 0.135 ms | 0.124 ms | -7.90 | Go-B |
| redis.find.2.p95 | 0.174 ms | 0.134 ms | -23.21 | Go-B |
| redis.find.2.p99 | 0.541 ms | 0.140 ms | -74.16 | Go-B |
| redis.find.2.mean | 0.150 ms | 0.125 ms | -16.99 | Go-B |
| redis.find.3.min | 0.093 ms | 0.098 ms | 4.77 | Go-A |
| redis.find.3.p50 | 0.104 ms | 0.106 ms | 1.80 | Go-A |
| redis.find.3.p95 | 0.291 ms | 0.144 ms | -50.52 | Go-B |
| redis.find.3.p99 | 0.436 ms | 0.283 ms | -35.04 | Go-B |
| redis.find.3.mean | 0.125 ms | 0.116 ms | -7.28 | Go-B |
| redis.search.common.min | 6.358 ms | 5.005 ms | -21.27 | Go-B |
| redis.search.common.p50 | 6.799 ms | 5.259 ms | -22.64 | Go-B |
| redis.search.common.p95 | 8.982 ms | 5.617 ms | -37.46 | Go-B |
| redis.search.common.p99 | 15.236 ms | 5.955 ms | -60.91 | Go-B |
| redis.search.common.mean | 7.182 ms | 5.306 ms | -26.12 | Go-B |
| redis.search.rare.min | 13.969 ms | 12.233 ms | -12.43 | Go-B |
| redis.search.rare.p50 | 15.818 ms | 12.650 ms | -20.03 | Go-B |
| redis.search.rare.p95 | 54.153 ms | 13.330 ms | -75.39 | Go-B |
| redis.search.rare.p99 | 55.163 ms | 13.337 ms | -75.82 | Go-B |
| redis.search.rare.mean | 22.484 ms | 12.715 ms | -43.45 | Go-B |
| redis.search.regex.min | 28.524 ms | 22.800 ms | -20.07 | Go-B |
| redis.search.regex.p50 | 33.647 ms | 24.230 ms | -27.99 | Go-B |
| redis.search.regex.p95 | 44.113 ms | 26.780 ms | -39.29 | Go-B |
| redis.search.regex.p99 | 52.127 ms | 27.430 ms | -47.38 | Go-B |
| redis.search.regex.mean | 35.520 ms | 24.551 ms | -30.88 | Go-B |
| redis.search.case-word.min | 12.902 ms | 10.453 ms | -18.98 | Go-B |
| redis.search.case-word.p50 | 14.728 ms | 11.154 ms | -24.26 | Go-B |
| redis.search.case-word.p95 | 19.452 ms | 13.918 ms | -28.45 | Go-B |
| redis.search.case-word.p99 | 20.130 ms | 14.212 ms | -29.40 | Go-B |
| redis.search.case-word.mean | 15.264 ms | 11.347 ms | -25.66 | Go-B |
| redis.search.no-hit.min | 17.317 ms | 15.732 ms | -9.16 | Go-B |
| redis.search.no-hit.p50 | 19.014 ms | 16.359 ms | -13.97 | Go-B |
| redis.search.no-hit.p95 | 59.390 ms | 41.083 ms | -30.82 | Go-B |
| redis.search.no-hit.p99 | 61.336 ms | 49.687 ms | -18.99 | Go-B |
| redis.search.no-hit.mean | 22.745 ms | 18.640 ms | -18.05 | Go-B |
| redis.file.large.min | 0.404 ms | 0.374 ms | -7.38 | Go-B |
| redis.file.large.p50 | 0.466 ms | 0.453 ms | -2.82 | Go-B |
| redis.file.large.p95 | 0.607 ms | 0.669 ms | 10.18 | Go-A |
| redis.file.large.p99 | 0.633 ms | 0.728 ms | 15.04 | Go-A |
| redis.file.large.mean | 0.485 ms | 0.488 ms | 0.55 | Go-A |
| redis.file.typical.min | 0.165 ms | 0.162 ms | -1.97 | Go-B |
| redis.file.typical.p50 | 0.183 ms | 0.172 ms | -5.93 | Go-B |
| redis.file.typical.p95 | 0.259 ms | 0.315 ms | 21.70 | Go-A |
| redis.file.typical.p99 | 0.507 ms | 0.492 ms | -3.13 | Go-B |
| redis.file.typical.mean | 0.209 ms | 0.196 ms | -6.06 | Go-B |
| redis.file.scroll.min | 0.342 ms | 0.293 ms | -14.23 | Go-B |
| redis.file.scroll.p50 | 0.380 ms | 0.313 ms | -17.61 | Go-B |
| redis.file.scroll.p95 | 0.535 ms | 0.471 ms | -11.85 | Go-B |
| redis.file.scroll.p99 | 0.603 ms | 0.508 ms | -15.75 | Go-B |
| redis.file.scroll.mean | 0.406 ms | 0.344 ms | -15.45 | Go-B |
| redis.markdown.min | 1.719 ms | 1.428 ms | -16.93 | Go-B |
| redis.markdown.p50 | 1.875 ms | 1.560 ms | -16.83 | Go-B |
| redis.markdown.p95 | 2.487 ms | 2.380 ms | -4.31 | Go-B |
| redis.markdown.p99 | 2.494 ms | 2.804 ms | 12.42 | Go-A |
| redis.markdown.mean | 1.990 ms | 1.703 ms | -14.45 | Go-B |
| redis.outline.min | 0.290 ms | 0.253 ms | -12.89 | Go-B |
| redis.outline.p50 | 0.308 ms | 0.265 ms | -14.07 | Go-B |
| redis.outline.p95 | 0.341 ms | 0.300 ms | -12.14 | Go-B |
| redis.outline.p99 | 0.368 ms | 0.446 ms | 21.29 | Go-A |
| redis.outline.mean | 0.315 ms | 0.276 ms | -12.19 | Go-B |
| redis.def.min | 17.422 ms | 16.743 ms | -3.90 | Go-B |
| redis.def.p50 | 20.117 ms | 18.192 ms | -9.57 | Go-B |
| redis.def.p95 | 23.282 ms | 20.105 ms | -13.65 | Go-B |
| redis.def.p99 | 62.751 ms | 20.789 ms | -66.87 | Go-B |
| redis.def.mean | 21.519 ms | 18.311 ms | -14.91 | Go-B |
| redis.git.refresh.min | 85.488 ms | 71.650 ms | -16.19 | Go-B |
| redis.git.refresh.p50 | 91.792 ms | 72.878 ms | -20.60 | Go-B |
| redis.git.refresh.p95 | 106.921 ms | 80.953 ms | -24.29 | Go-B |
| redis.git.refresh.p99 | 107.811 ms | 82.150 ms | -23.80 | Go-B |
| redis.git.refresh.mean | 93.675 ms | 74.146 ms | -20.85 | Go-B |
| redis.diff.min | 14.778 ms | 12.221 ms | -17.30 | Go-B |
| redis.diff.p50 | 15.904 ms | 12.758 ms | -19.78 | Go-B |
| redis.diff.p95 | 17.605 ms | 13.543 ms | -23.07 | Go-B |
| redis.diff.p99 | 22.666 ms | 14.017 ms | -38.16 | Go-B |
| redis.diff.mean | 16.199 ms | 12.844 ms | -20.71 | Go-B |
| redis.gutter.min | 12.354 ms | 10.421 ms | -15.64 | Go-B |
| redis.gutter.p50 | 13.319 ms | 10.929 ms | -17.95 | Go-B |
| redis.gutter.p95 | 16.625 ms | 12.529 ms | -24.64 | Go-B |
| redis.gutter.p99 | 17.729 ms | 13.132 ms | -25.93 | Go-B |
| redis.gutter.mean | 13.826 ms | 11.111 ms | -19.63 | Go-B |
| redis.file.cold | 32.632 ms | 23.965 ms | -26.56 | Go-B |
| redis.file.warm | 0.776 ms | 0.939 ms | 21.08 | Go-A |
| redis.sse.save.min | 84.186 ms | 73.532 ms | -12.66 | Go-B |
| redis.sse.save.p50 | 136.347 ms | 126.656 ms | -7.11 | Go-B |
| redis.sse.save.p95 | 149.038 ms | 139.325 ms | -6.52 | Go-B |
| redis.sse.save.p99 | 149.038 ms | 139.325 ms | -6.52 | Go-B |
| redis.sse.save.mean | 120.958 ms | 112.728 ms | -6.80 | Go-B |
| redis.sse.save.timeouts | 0.000 count | 0.000 count | n/a | equal |
| redis.sse.external.min | 762.182 ms | 72.316 ms | -90.51 | Go-B |
| redis.sse.external.p50 | 920.770 ms | 925.361 ms | 0.50 | Go-A |
| redis.sse.external.p95 | 925.600 ms | 1059.806 ms | 14.50 | Go-A |
| redis.sse.external.p99 | 925.600 ms | 1059.806 ms | 14.50 | Go-A |
| redis.sse.external.mean | 905.258 ms | 779.082 ms | -13.94 | Go-B |
| redis.sse.external.timeouts | 0.000 count | 0.000 count | n/a | equal |
| redis.throughput.C1 | 51.553 req/s | 67.367 req/s | 30.68 | Go-B |
| redis.throughput.C1.errors | 0.000 count | 0.000 count | n/a | equal |
| redis.throughput.C1.min | 0.157 ms | 0.134 ms | -14.71 | Go-B |
| redis.throughput.C1.p50 | 0.830 ms | 0.661 ms | -20.32 | Go-B |
| redis.throughput.C1.p95 | 85.417 ms | 65.625 ms | -23.17 | Go-B |
| redis.throughput.C1.p99 | 90.352 ms | 67.799 ms | -24.96 | Go-B |
| redis.throughput.C1.mean | 19.246 ms | 14.729 ms | -23.47 | Go-B |
| redis.throughput.C8 | 177.029 req/s | 224.034 req/s | 26.55 | Go-B |
| redis.throughput.C8.errors | 0.000 count | 0.000 count | n/a | equal |
| redis.throughput.C8.min | 0.195 ms | 0.245 ms | 25.68 | Go-A |
| redis.throughput.C8.p50 | 5.206 ms | 3.855 ms | -25.94 | Go-B |
| redis.throughput.C8.p95 | 201.307 ms | 159.440 ms | -20.80 | Go-B |
| redis.throughput.C8.p99 | 229.831 ms | 171.163 ms | -25.53 | Go-B |
| redis.throughput.C8.mean | 44.498 ms | 35.266 ms | -20.75 | Go-B |
| redis.throughput.C32 | 169.572 req/s | 202.088 req/s | 19.18 | Go-B |
| redis.throughput.C32.errors | 0.000 count | 0.000 count | n/a | equal |
| redis.throughput.C32.min | 0.697 ms | 0.388 ms | -44.33 | Go-B |
| redis.throughput.C32.p50 | 52.091 ms | 39.380 ms | -24.40 | Go-B |
| redis.throughput.C32.p95 | 812.339 ms | 686.635 ms | -15.47 | Go-B |
| redis.throughput.C32.p99 | 929.842 ms | 822.254 ms | -11.57 | Go-B |
| redis.throughput.C32.mean | 184.947 ms | 155.204 ms | -16.08 | Go-B |
| redis.under-load.meta.min | 202.904 ms | 196.636 ms | -3.09 | Go-B |
| redis.under-load.meta.p50 | 277.684 ms | 288.708 ms | 3.97 | Go-A |
| redis.under-load.meta.p95 | 340.860 ms | 373.072 ms | 9.45 | Go-A |
| redis.under-load.meta.p99 | 351.474 ms | 375.633 ms | 6.87 | Go-A |
| redis.under-load.meta.mean | 279.720 ms | 290.081 ms | 3.70 | Go-A |
| redis.rss.readyBytes | 30.05 MiB | 28.39 MiB | -5.51 | Go-B |
| redis.rss.peakBytes | 1118.80 MiB | 1265.16 MiB | 13.08 | Go-A |
| redis.rss.idleBytes | 39.02 MiB | 63.47 MiB | 62.68 | Go-A |
| react.startup.first.min | 124.308 ms | 117.419 ms | -5.54 | Go-B |
| react.startup.first.p50 | 130.241 ms | 118.828 ms | -8.76 | Go-B |
| react.startup.first.p95 | 376.476 ms | 363.746 ms | -3.38 | Go-B |
| react.startup.first.p99 | 376.476 ms | 363.746 ms | -3.38 | Go-B |
| react.startup.first.mean | 178.905 ms | 167.587 ms | -6.33 | Go-B |
| react.startup.ready.min | 1535.591 ms | 1462.633 ms | -4.75 | Go-B |
| react.startup.ready.p50 | 1601.526 ms | 1519.300 ms | -5.13 | Go-B |
| react.startup.ready.p95 | 1612.423 ms | 1578.675 ms | -2.09 | Go-B |
| react.startup.ready.p99 | 1612.423 ms | 1578.675 ms | -2.09 | Go-B |
| react.startup.ready.mean | 1591.082 ms | 1520.050 ms | -4.46 | Go-B |
| react.meta.min | 65.747 ms | 62.776 ms | -4.52 | Go-B |
| react.meta.p50 | 69.403 ms | 64.296 ms | -7.36 | Go-B |
| react.meta.p95 | 75.742 ms | 68.683 ms | -9.32 | Go-B |
| react.meta.p99 | 76.449 ms | 69.657 ms | -8.88 | Go-B |
| react.meta.mean | 70.186 ms | 64.604 ms | -7.95 | Go-B |
| react.tree.root.min | 0.072 ms | 0.081 ms | 13.00 | Go-A |
| react.tree.root.p50 | 0.081 ms | 0.094 ms | 17.23 | Go-A |
| react.tree.root.p95 | 0.114 ms | 0.215 ms | 88.85 | Go-A |
| react.tree.root.p99 | 0.190 ms | 0.223 ms | 17.04 | Go-A |
| react.tree.root.mean | 0.087 ms | 0.103 ms | 18.33 | Go-A |
| react.tree.deep.min | 0.057 ms | 0.063 ms | 10.98 | Go-A |
| react.tree.deep.p50 | 0.063 ms | 0.072 ms | 14.32 | Go-A |
| react.tree.deep.p95 | 0.075 ms | 0.094 ms | 25.98 | Go-A |
| react.tree.deep.p99 | 0.078 ms | 0.102 ms | 31.26 | Go-A |
| react.tree.deep.mean | 0.063 ms | 0.073 ms | 14.91 | Go-A |
| react.find.0.min | 0.238 ms | 0.248 ms | 4.25 | Go-A |
| react.find.0.p50 | 0.279 ms | 0.287 ms | 2.85 | Go-A |
| react.find.0.p95 | 0.443 ms | 0.429 ms | -3.09 | Go-B |
| react.find.0.p99 | 0.499 ms | 0.554 ms | 11.02 | Go-A |
| react.find.0.mean | 0.290 ms | 0.298 ms | 2.68 | Go-A |
| react.find.1.min | 0.336 ms | 0.349 ms | 3.94 | Go-A |
| react.find.1.p50 | 0.392 ms | 0.379 ms | -3.36 | Go-B |
| react.find.1.p95 | 0.545 ms | 0.540 ms | -0.90 | Go-B |
| react.find.1.p99 | 0.799 ms | 0.697 ms | -12.75 | Go-B |
| react.find.1.mean | 0.407 ms | 0.402 ms | -1.10 | Go-B |
| react.find.2.min | 0.244 ms | 0.226 ms | -7.40 | Go-B |
| react.find.2.p50 | 0.281 ms | 0.268 ms | -4.81 | Go-B |
| react.find.2.p95 | 0.473 ms | 0.435 ms | -7.96 | Go-B |
| react.find.2.p99 | 0.478 ms | 0.453 ms | -5.11 | Go-B |
| react.find.2.mean | 0.300 ms | 0.287 ms | -4.23 | Go-B |
| react.find.3.min | 0.214 ms | 0.216 ms | 0.96 | Go-A |
| react.find.3.p50 | 0.242 ms | 0.245 ms | 1.45 | Go-A |
| react.find.3.p95 | 0.335 ms | 0.356 ms | 6.48 | Go-A |
| react.find.3.p99 | 0.476 ms | 0.422 ms | -11.38 | Go-B |
| react.find.3.mean | 0.255 ms | 0.256 ms | 0.39 | Go-A |
| react.search.common.min | 6.262 ms | 5.060 ms | -19.18 | Go-B |
| react.search.common.p50 | 6.794 ms | 5.671 ms | -16.53 | Go-B |
| react.search.common.p95 | 7.368 ms | 6.111 ms | -17.06 | Go-B |
| react.search.common.p99 | 7.611 ms | 6.178 ms | -18.83 | Go-B |
| react.search.common.mean | 6.776 ms | 5.716 ms | -15.64 | Go-B |
| react.search.rare.min | 59.145 ms | 47.223 ms | -20.16 | Go-B |
| react.search.rare.p50 | 61.265 ms | 51.280 ms | -16.30 | Go-B |
| react.search.rare.p95 | 63.984 ms | 52.370 ms | -18.15 | Go-B |
| react.search.rare.p99 | 65.295 ms | 52.901 ms | -18.98 | Go-B |
| react.search.rare.mean | 61.460 ms | 51.025 ms | -16.98 | Go-B |
| react.search.regex.min | 30.881 ms | 25.918 ms | -16.07 | Go-B |
| react.search.regex.p50 | 36.413 ms | 27.282 ms | -25.08 | Go-B |
| react.search.regex.p95 | 39.517 ms | 29.197 ms | -26.12 | Go-B |
| react.search.regex.p99 | 40.259 ms | 31.038 ms | -22.90 | Go-B |
| react.search.regex.mean | 36.410 ms | 27.433 ms | -24.66 | Go-B |
| react.search.case-word.min | 16.279 ms | 12.222 ms | -24.92 | Go-B |
| react.search.case-word.p50 | 17.964 ms | 13.056 ms | -27.33 | Go-B |
| react.search.case-word.p95 | 21.746 ms | 14.567 ms | -33.01 | Go-B |
| react.search.case-word.p99 | 21.842 ms | 14.581 ms | -33.24 | Go-B |
| react.search.case-word.mean | 18.457 ms | 13.224 ms | -28.36 | Go-B |
| react.search.no-hit.min | 76.546 ms | 70.103 ms | -8.42 | Go-B |
| react.search.no-hit.p50 | 81.786 ms | 71.459 ms | -12.63 | Go-B |
| react.search.no-hit.p95 | 86.978 ms | 72.851 ms | -16.24 | Go-B |
| react.search.no-hit.p99 | 93.034 ms | 76.585 ms | -17.68 | Go-B |
| react.search.no-hit.mean | 82.271 ms | 71.716 ms | -12.83 | Go-B |
| react.file.large.min | 0.348 ms | 0.275 ms | -21.10 | Go-B |
| react.file.large.p50 | 0.385 ms | 0.296 ms | -23.34 | Go-B |
| react.file.large.p95 | 0.554 ms | 0.391 ms | -29.44 | Go-B |
| react.file.large.p99 | 0.626 ms | 0.481 ms | -23.18 | Go-B |
| react.file.large.mean | 0.417 ms | 0.311 ms | -25.30 | Go-B |
| react.file.typical.min | 0.162 ms | 0.137 ms | -15.95 | Go-B |
| react.file.typical.p50 | 0.176 ms | 0.149 ms | -15.62 | Go-B |
| react.file.typical.p95 | 0.249 ms | 0.228 ms | -8.43 | Go-B |
| react.file.typical.p99 | 0.464 ms | 0.343 ms | -25.95 | Go-B |
| react.file.typical.mean | 0.192 ms | 0.160 ms | -16.42 | Go-B |
| react.file.scroll.min | 0.282 ms | 0.225 ms | -20.26 | Go-B |
| react.file.scroll.p50 | 0.299 ms | 0.244 ms | -18.53 | Go-B |
| react.file.scroll.p95 | 0.378 ms | 0.291 ms | -23.12 | Go-B |
| react.file.scroll.p99 | 0.388 ms | 0.340 ms | -12.33 | Go-B |
| react.file.scroll.mean | 0.306 ms | 0.251 ms | -17.81 | Go-B |
| react.markdown.min | 0.387 ms | 0.330 ms | -14.69 | Go-B |
| react.markdown.p50 | 0.415 ms | 0.349 ms | -16.09 | Go-B |
| react.markdown.p95 | 0.654 ms | 0.869 ms | 32.89 | Go-A |
| react.markdown.p99 | 0.700 ms | 0.889 ms | 26.99 | Go-A |
| react.markdown.mean | 0.438 ms | 0.405 ms | -7.50 | Go-B |
| react.outline.min | 0.509 ms | 0.415 ms | -18.53 | Go-B |
| react.outline.p50 | 0.520 ms | 0.434 ms | -16.48 | Go-B |
| react.outline.p95 | 0.537 ms | 0.448 ms | -16.50 | Go-B |
| react.outline.p99 | 0.663 ms | 0.451 ms | -31.93 | Go-B |
| react.outline.mean | 0.526 ms | 0.434 ms | -17.46 | Go-B |
| react.def.min | 91.353 ms | 80.250 ms | -12.15 | Go-B |
| react.def.p50 | 95.477 ms | 83.446 ms | -12.60 | Go-B |
| react.def.p95 | 100.882 ms | 86.641 ms | -14.12 | Go-B |
| react.def.p99 | 101.085 ms | 89.216 ms | -11.74 | Go-B |
| react.def.mean | 95.915 ms | 83.837 ms | -12.59 | Go-B |
| react.git.refresh.min | 93.373 ms | 92.344 ms | -1.10 | Go-B |
| react.git.refresh.p50 | 95.989 ms | 93.835 ms | -2.24 | Go-B |
| react.git.refresh.p95 | 103.079 ms | 95.123 ms | -7.72 | Go-B |
| react.git.refresh.p99 | 110.809 ms | 96.928 ms | -12.53 | Go-B |
| react.git.refresh.mean | 96.889 ms | 93.754 ms | -3.24 | Go-B |
| react.diff.min | 12.802 ms | 13.066 ms | 2.06 | Go-A |
| react.diff.p50 | 13.224 ms | 13.321 ms | 0.73 | Go-A |
| react.diff.p95 | 13.768 ms | 19.182 ms | 39.32 | Go-A |
| react.diff.p99 | 14.413 ms | 24.697 ms | 71.35 | Go-A |
| react.diff.mean | 13.274 ms | 14.410 ms | 8.56 | Go-A |
| react.gutter.min | 10.763 ms | 10.901 ms | 1.29 | Go-A |
| react.gutter.p50 | 11.042 ms | 11.302 ms | 2.35 | Go-A |
| react.gutter.p95 | 11.765 ms | 12.504 ms | 6.28 | Go-A |
| react.gutter.p99 | 12.167 ms | 12.768 ms | 4.94 | Go-A |
| react.gutter.mean | 11.150 ms | 11.428 ms | 2.49 | Go-A |
| react.file.cold | 31.080 ms | 26.062 ms | -16.15 | Go-B |
| react.file.warm | 0.883 ms | 0.703 ms | -20.31 | Go-B |
| react.sse.save.min | 93.041 ms | 146.396 ms | 57.34 | Go-A |
| react.sse.save.p50 | 147.356 ms | 150.426 ms | 2.08 | Go-A |
| react.sse.save.p95 | 153.416 ms | 157.351 ms | 2.57 | Go-A |
| react.sse.save.p99 | 153.416 ms | 157.351 ms | 2.57 | Go-A |
| react.sse.save.mean | 142.552 ms | 151.735 ms | 6.44 | Go-A |
| react.sse.save.timeouts | 0.000 count | 0.000 count | n/a | equal |
| react.sse.external.min | 93.853 ms | 99.315 ms | 5.82 | Go-A |
| react.sse.external.p50 | 903.717 ms | 894.846 ms | -0.98 | Go-B |
| react.sse.external.p95 | 956.768 ms | 912.841 ms | -4.59 | Go-B |
| react.sse.external.p99 | 956.768 ms | 912.841 ms | -4.59 | Go-B |
| react.sse.external.mean | 820.095 ms | 811.602 ms | -1.04 | Go-B |
| react.sse.external.timeouts | 0.000 count | 0.000 count | n/a | equal |
| react.throughput.C1 | 68.766 req/s | 64.810 req/s | -5.75 | Go-A |
| react.throughput.C1.errors | 0.000 count | 0.000 count | n/a | equal |
| react.throughput.C1.min | 0.145 ms | 0.152 ms | 4.41 | Go-A |
| react.throughput.C1.p50 | 0.531 ms | 0.557 ms | 4.95 | Go-A |
| react.throughput.C1.p95 | 64.174 ms | 69.239 ms | 7.89 | Go-A |
| react.throughput.C1.p99 | 66.031 ms | 71.764 ms | 8.68 | Go-A |
| react.throughput.C1.mean | 14.449 ms | 15.331 ms | 6.10 | Go-A |
| react.throughput.C8 | 213.379 req/s | 225.495 req/s | 5.68 | Go-B |
| react.throughput.C8.errors | 0.000 count | 0.000 count | n/a | equal |
| react.throughput.C8.min | 0.227 ms | 0.245 ms | 8.26 | Go-A |
| react.throughput.C8.p50 | 3.890 ms | 3.651 ms | -6.16 | Go-B |
| react.throughput.C8.p95 | 179.291 ms | 160.097 ms | -10.71 | Go-B |
| react.throughput.C8.p99 | 194.272 ms | 169.502 ms | -12.75 | Go-B |
| react.throughput.C8.mean | 37.085 ms | 35.117 ms | -5.31 | Go-B |
| react.throughput.C32 | 176.086 req/s | 196.669 req/s | 11.69 | Go-B |
| react.throughput.C32.errors | 0.000 count | 0.000 count | n/a | equal |
| react.throughput.C32.min | 0.527 ms | 0.301 ms | -42.85 | Go-B |
| react.throughput.C32.p50 | 36.026 ms | 30.628 ms | -14.98 | Go-B |
| react.throughput.C32.p95 | 802.487 ms | 749.655 ms | -6.58 | Go-B |
| react.throughput.C32.p99 | 955.834 ms | 854.759 ms | -10.57 | Go-B |
| react.throughput.C32.mean | 178.837 ms | 160.460 ms | -10.28 | Go-B |
| react.under-load.meta.min | 191.588 ms | 203.521 ms | 6.23 | Go-A |
| react.under-load.meta.p50 | 292.713 ms | 284.471 ms | -2.82 | Go-B |
| react.under-load.meta.p95 | 384.054 ms | 400.822 ms | 4.37 | Go-A |
| react.under-load.meta.p99 | 444.227 ms | 402.927 ms | -9.30 | Go-B |
| react.under-load.meta.mean | 296.476 ms | 289.655 ms | -2.30 | Go-B |
| react.rss.readyBytes | 32.25 MiB | 39.33 MiB | 21.95 | Go-A |
| react.rss.peakBytes | 1366.73 MiB | 1154.47 MiB | -15.53 | Go-B |
| react.rss.idleBytes | 103.34 MiB | 36.95 MiB | -64.24 | Go-B |
| kubernetes.startup.first.min | 193.822 ms | 203.412 ms | 4.95 | Go-A |
| kubernetes.startup.first.p50 | 202.002 ms | 223.856 ms | 10.82 | Go-A |
| kubernetes.startup.first.p95 | 384.689 ms | 457.138 ms | 18.83 | Go-A |
| kubernetes.startup.first.p99 | 384.689 ms | 457.138 ms | 18.83 | Go-A |
| kubernetes.startup.first.mean | 236.518 ms | 265.954 ms | 12.45 | Go-A |
| kubernetes.startup.ready.min | 8763.123 ms | 8890.037 ms | 1.45 | Go-A |
| kubernetes.startup.ready.p50 | 9021.379 ms | 9110.872 ms | 0.99 | Go-A |
| kubernetes.startup.ready.p95 | 9726.792 ms | 9293.998 ms | -4.45 | Go-B |
| kubernetes.startup.ready.p99 | 9726.792 ms | 9293.998 ms | -4.45 | Go-B |
| kubernetes.startup.ready.mean | 9082.788 ms | 9112.455 ms | 0.33 | Go-A |
| kubernetes.meta.min | 92.468 ms | 95.072 ms | 2.82 | Go-A |
| kubernetes.meta.p50 | 114.430 ms | 112.781 ms | -1.44 | Go-B |
| kubernetes.meta.p95 | 130.747 ms | 130.514 ms | -0.18 | Go-B |
| kubernetes.meta.p99 | 152.905 ms | 131.178 ms | -14.21 | Go-B |
| kubernetes.meta.mean | 111.287 ms | 112.935 ms | 1.48 | Go-A |
| kubernetes.tree.root.min | 0.096 ms | 0.111 ms | 15.48 | Go-A |
| kubernetes.tree.root.p50 | 0.110 ms | 0.125 ms | 13.22 | Go-A |
| kubernetes.tree.root.p95 | 0.147 ms | 0.162 ms | 10.27 | Go-A |
| kubernetes.tree.root.p99 | 0.260 ms | 0.244 ms | -6.48 | Go-B |
| kubernetes.tree.root.mean | 0.118 ms | 0.132 ms | 11.56 | Go-A |
| kubernetes.tree.deep.min | 0.081 ms | 0.095 ms | 16.62 | Go-A |
| kubernetes.tree.deep.p50 | 0.097 ms | 0.109 ms | 12.29 | Go-A |
| kubernetes.tree.deep.p95 | 0.122 ms | 0.128 ms | 4.91 | Go-A |
| kubernetes.tree.deep.p99 | 0.169 ms | 0.142 ms | -15.88 | Go-B |
| kubernetes.tree.deep.mean | 0.100 ms | 0.111 ms | 10.69 | Go-A |
| kubernetes.find.0.min | 0.669 ms | 0.678 ms | 1.32 | Go-A |
| kubernetes.find.0.p50 | 0.742 ms | 0.774 ms | 4.37 | Go-A |
| kubernetes.find.0.p95 | 1.031 ms | 1.014 ms | -1.64 | Go-B |
| kubernetes.find.0.p99 | 1.643 ms | 1.037 ms | -36.90 | Go-B |
| kubernetes.find.0.mean | 0.784 ms | 0.800 ms | 2.01 | Go-A |
| kubernetes.find.1.min | 0.647 ms | 0.619 ms | -4.32 | Go-B |
| kubernetes.find.1.p50 | 0.694 ms | 0.683 ms | -1.62 | Go-B |
| kubernetes.find.1.p95 | 0.756 ms | 1.142 ms | 51.04 | Go-A |
| kubernetes.find.1.p99 | 0.775 ms | 1.156 ms | 49.19 | Go-A |
| kubernetes.find.1.mean | 0.701 ms | 0.723 ms | 3.21 | Go-A |
| kubernetes.find.2.min | 0.879 ms | 0.848 ms | -3.56 | Go-B |
| kubernetes.find.2.p50 | 0.941 ms | 0.922 ms | -1.97 | Go-B |
| kubernetes.find.2.p95 | 1.099 ms | 1.046 ms | -4.83 | Go-B |
| kubernetes.find.2.p99 | 2.044 ms | 1.123 ms | -45.05 | Go-B |
| kubernetes.find.2.mean | 0.984 ms | 0.935 ms | -5.02 | Go-B |
| kubernetes.find.3.min | 0.545 ms | 0.561 ms | 2.99 | Go-A |
| kubernetes.find.3.p50 | 0.593 ms | 0.610 ms | 2.77 | Go-A |
| kubernetes.find.3.p95 | 0.633 ms | 0.771 ms | 21.83 | Go-A |
| kubernetes.find.3.p99 | 0.638 ms | 1.018 ms | 59.44 | Go-A |
| kubernetes.find.3.mean | 0.592 ms | 0.631 ms | 6.58 | Go-A |
| kubernetes.search.common.min | 22.773 ms | 23.754 ms | 4.31 | Go-A |
| kubernetes.search.common.p50 | 24.672 ms | 28.434 ms | 15.25 | Go-A |
| kubernetes.search.common.p95 | 27.820 ms | 30.073 ms | 8.10 | Go-A |
| kubernetes.search.common.p99 | 28.771 ms | 30.159 ms | 4.83 | Go-A |
| kubernetes.search.common.mean | 24.939 ms | 27.888 ms | 11.83 | Go-A |
| kubernetes.search.rare.min | 17.768 ms | 19.967 ms | 12.38 | Go-A |
| kubernetes.search.rare.p50 | 19.535 ms | 21.476 ms | 9.93 | Go-A |
| kubernetes.search.rare.p95 | 24.190 ms | 23.754 ms | -1.80 | Go-B |
| kubernetes.search.rare.p99 | 24.276 ms | 26.196 ms | 7.91 | Go-A |
| kubernetes.search.rare.mean | 20.142 ms | 21.731 ms | 7.89 | Go-A |
| kubernetes.search.regex.min | 236.052 ms | 249.797 ms | 5.82 | Go-A |
| kubernetes.search.regex.p50 | 248.573 ms | 260.873 ms | 4.95 | Go-A |
| kubernetes.search.regex.p95 | 312.500 ms | 287.823 ms | -7.90 | Go-B |
| kubernetes.search.regex.p99 | 349.659 ms | 293.030 ms | -16.20 | Go-B |
| kubernetes.search.regex.mean | 259.131 ms | 263.395 ms | 1.65 | Go-A |
| kubernetes.search.case-word.min | 143.168 ms | 160.712 ms | 12.25 | Go-A |
| kubernetes.search.case-word.p50 | 156.795 ms | 167.506 ms | 6.83 | Go-A |
| kubernetes.search.case-word.p95 | 161.074 ms | 177.385 ms | 10.13 | Go-A |
| kubernetes.search.case-word.p99 | 163.516 ms | 183.574 ms | 12.27 | Go-A |
| kubernetes.search.case-word.mean | 154.622 ms | 168.575 ms | 9.02 | Go-A |
| kubernetes.search.no-hit.min | 751.775 ms | 798.854 ms | 6.26 | Go-A |
| kubernetes.search.no-hit.p50 | 826.547 ms | 847.014 ms | 2.48 | Go-A |
| kubernetes.search.no-hit.p95 | 1106.521 ms | 868.492 ms | -21.51 | Go-B |
| kubernetes.search.no-hit.p99 | 1180.148 ms | 1147.003 ms | -2.81 | Go-B |
| kubernetes.search.no-hit.mean | 873.656 ms | 853.063 ms | -2.36 | Go-B |
| kubernetes.file.large.min | 0.266 ms | 0.271 ms | 2.13 | Go-A |
| kubernetes.file.large.p50 | 0.291 ms | 0.300 ms | 2.86 | Go-A |
| kubernetes.file.large.p95 | 0.347 ms | 0.359 ms | 3.47 | Go-A |
| kubernetes.file.large.p99 | 0.386 ms | 0.364 ms | -5.77 | Go-B |
| kubernetes.file.large.mean | 0.300 ms | 0.310 ms | 3.37 | Go-A |
| kubernetes.file.typical.min | 0.193 ms | 0.209 ms | 8.60 | Go-A |
| kubernetes.file.typical.p50 | 0.202 ms | 0.230 ms | 13.82 | Go-A |
| kubernetes.file.typical.p95 | 0.250 ms | 0.280 ms | 12.00 | Go-A |
| kubernetes.file.typical.p99 | 0.304 ms | 0.295 ms | -2.84 | Go-B |
| kubernetes.file.typical.mean | 0.209 ms | 0.236 ms | 12.92 | Go-A |
| kubernetes.file.scroll.min | 0.238 ms | 0.252 ms | 5.90 | Go-A |
| kubernetes.file.scroll.p50 | 0.247 ms | 0.262 ms | 5.97 | Go-A |
| kubernetes.file.scroll.p95 | 0.294 ms | 0.283 ms | -3.95 | Go-B |
| kubernetes.file.scroll.p99 | 0.301 ms | 0.312 ms | 3.57 | Go-A |
| kubernetes.file.scroll.mean | 0.253 ms | 0.265 ms | 4.69 | Go-A |
| kubernetes.markdown.min | 0.204 ms | 0.219 ms | 7.06 | Go-A |
| kubernetes.markdown.p50 | 0.218 ms | 0.224 ms | 2.81 | Go-A |
| kubernetes.markdown.p95 | 0.249 ms | 0.260 ms | 4.35 | Go-A |
| kubernetes.markdown.p99 | 0.285 ms | 0.296 ms | 3.86 | Go-A |
| kubernetes.markdown.mean | 0.224 ms | 0.232 ms | 3.61 | Go-A |
| kubernetes.outline.min | 0.178 ms | 0.180 ms | 1.10 | Go-A |
| kubernetes.outline.p50 | 0.187 ms | 0.194 ms | 3.33 | Go-A |
| kubernetes.outline.p95 | 0.215 ms | 0.216 ms | 0.47 | Go-A |
| kubernetes.outline.p99 | 0.229 ms | 0.221 ms | -3.69 | Go-B |
| kubernetes.outline.mean | 0.191 ms | 0.196 ms | 2.54 | Go-A |
| kubernetes.def.min | 793.312 ms | 779.140 ms | -1.79 | Go-B |
| kubernetes.def.p50 | 915.642 ms | 987.498 ms | 7.85 | Go-A |
| kubernetes.def.p95 | 1780.674 ms | 1476.841 ms | -17.06 | Go-B |
| kubernetes.def.p99 | 1815.334 ms | 1794.948 ms | -1.12 | Go-B |
| kubernetes.def.mean | 1044.499 ms | 1067.767 ms | 2.23 | Go-A |
| kubernetes.git.refresh.min | 365.125 ms | 374.936 ms | 2.69 | Go-A |
| kubernetes.git.refresh.p50 | 380.902 ms | 386.750 ms | 1.54 | Go-A |
| kubernetes.git.refresh.p95 | 461.479 ms | 470.723 ms | 2.00 | Go-A |
| kubernetes.git.refresh.p99 | 466.406 ms | 498.912 ms | 6.97 | Go-A |
| kubernetes.git.refresh.mean | 402.647 ms | 405.862 ms | 0.80 | Go-A |
| kubernetes.diff.min | 27.025 ms | 27.294 ms | 1.00 | Go-A |
| kubernetes.diff.p50 | 28.289 ms | 28.429 ms | 0.49 | Go-A |
| kubernetes.diff.p95 | 29.734 ms | 29.365 ms | -1.24 | Go-B |
| kubernetes.diff.p99 | 30.052 ms | 29.657 ms | -1.31 | Go-B |
| kubernetes.diff.mean | 28.245 ms | 28.454 ms | 0.74 | Go-A |
| kubernetes.gutter.min | 18.452 ms | 20.537 ms | 11.30 | Go-A |
| kubernetes.gutter.p50 | 20.734 ms | 21.174 ms | 2.12 | Go-A |
| kubernetes.gutter.p95 | 22.252 ms | 21.775 ms | -2.14 | Go-B |
| kubernetes.gutter.p99 | 22.562 ms | 21.977 ms | -2.59 | Go-B |
| kubernetes.gutter.mean | 20.814 ms | 21.226 ms | 1.98 | Go-A |
| kubernetes.table.min | 0.102 ms | 0.116 ms | 13.84 | Go-A |
| kubernetes.table.p50 | 0.118 ms | 0.131 ms | 11.23 | Go-A |
| kubernetes.table.p95 | 0.181 ms | 0.168 ms | -7.47 | Go-B |
| kubernetes.table.p99 | 0.187 ms | 0.592 ms | 216.68 | Go-A |
| kubernetes.table.mean | 0.126 ms | 0.149 ms | 18.05 | Go-A |
| kubernetes.file.cold | 69.472 ms | 70.176 ms | 1.01 | Go-A |
| kubernetes.file.warm | 0.727 ms | 0.657 ms | -9.63 | Go-B |
| kubernetes.sse.save.min | 356.335 ms | 373.370 ms | 4.78 | Go-A |
| kubernetes.sse.save.p50 | 401.857 ms | 426.200 ms | 6.06 | Go-A |
| kubernetes.sse.save.p95 | 557.040 ms | 491.369 ms | -11.79 | Go-B |
| kubernetes.sse.save.p99 | 557.040 ms | 491.369 ms | -11.79 | Go-B |
| kubernetes.sse.save.mean | 421.453 ms | 428.844 ms | 1.75 | Go-A |
| kubernetes.sse.save.timeouts | 0.000 count | 0.000 count | n/a | equal |
| kubernetes.sse.external.min | 342.497 ms | 324.896 ms | -5.14 | Go-B |
| kubernetes.sse.external.p50 | 1047.309 ms | 788.785 ms | -24.68 | Go-B |
| kubernetes.sse.external.p95 | 1087.640 ms | 1094.165 ms | 0.60 | Go-A |
| kubernetes.sse.external.p99 | 1087.640 ms | 1094.165 ms | 0.60 | Go-A |
| kubernetes.sse.external.mean | 936.370 ms | 784.290 ms | -16.24 | Go-B |
| kubernetes.sse.external.timeouts | 0.000 count | 0.000 count | n/a | equal |
| kubernetes.throughput.C1 | 57.933 req/s | 40.864 req/s | -29.46 | Go-A |
| kubernetes.throughput.C1.errors | 0.000 count | 0.000 count | n/a | equal |
| kubernetes.throughput.C1.min | 0.155 ms | 0.166 ms | 6.95 | Go-A |
| kubernetes.throughput.C1.p50 | 0.737 ms | 1.014 ms | 37.53 | Go-A |
| kubernetes.throughput.C1.p95 | 65.967 ms | 110.727 ms | 67.85 | Go-A |
| kubernetes.throughput.C1.p99 | 69.114 ms | 134.612 ms | 94.77 | Go-A |
| kubernetes.throughput.C1.mean | 17.096 ms | 24.230 ms | 41.73 | Go-A |
| kubernetes.throughput.C8 | 103.501 req/s | 93.387 req/s | -9.77 | Go-A |
| kubernetes.throughput.C8.errors | 0.000 count | 0.000 count | n/a | equal |
| kubernetes.throughput.C8.min | 0.245 ms | 0.301 ms | 22.90 | Go-A |
| kubernetes.throughput.C8.p50 | 15.561 ms | 16.615 ms | 6.77 | Go-A |
| kubernetes.throughput.C8.p95 | 295.973 ms | 324.866 ms | 9.76 | Go-A |
| kubernetes.throughput.C8.p99 | 331.320 ms | 366.950 ms | 10.75 | Go-A |
| kubernetes.throughput.C8.mean | 76.224 ms | 84.434 ms | 10.77 | Go-A |
| kubernetes.throughput.C32 | 85.612 req/s | 80.069 req/s | -6.47 | Go-A |
| kubernetes.throughput.C32.errors | 0.000 count | 0.000 count | n/a | equal |
| kubernetes.throughput.C32.min | 1.254 ms | 0.555 ms | -55.74 | Go-B |
| kubernetes.throughput.C32.p50 | 105.243 ms | 85.368 ms | -18.88 | Go-B |
| kubernetes.throughput.C32.p95 | 1311.335 ms | 1420.722 ms | 8.34 | Go-A |
| kubernetes.throughput.C32.p99 | 1642.969 ms | 1827.047 ms | 11.20 | Go-A |
| kubernetes.throughput.C32.mean | 367.432 ms | 392.342 ms | 6.78 | Go-A |
| kubernetes.under-load.meta.min | 372.808 ms | 410.220 ms | 10.04 | Go-A |
| kubernetes.under-load.meta.p50 | 553.320 ms | 506.468 ms | -8.47 | Go-B |
| kubernetes.under-load.meta.p95 | 802.469 ms | 1032.508 ms | 28.67 | Go-A |
| kubernetes.under-load.meta.p99 | 802.469 ms | 1032.508 ms | 28.67 | Go-A |
| kubernetes.under-load.meta.mean | 561.326 ms | 576.662 ms | 2.73 | Go-A |
| kubernetes.rss.readyBytes | 45.92 MiB | 48.09 MiB | 4.73 | Go-A |
| kubernetes.rss.peakBytes | 882.22 MiB | 916.72 MiB | 3.91 | Go-A |
| kubernetes.rss.idleBytes | 16.19 MiB | 48.34 MiB | 198.65 | Go-A |
| workbench.spawn | 9.903 ms | 10.174 ms | 2.74 | Go-A |
| workbench.open | 381.433 ms | 348.851 ms | -8.54 | Go-B |
| workbench.proxy.min | 74.448 ms | 75.470 ms | 1.37 | Go-A |
| workbench.proxy.p50 | 82.112 ms | 82.334 ms | 0.27 | Go-A |
| workbench.proxy.p95 | 86.799 ms | 94.237 ms | 8.57 | Go-A |
| workbench.proxy.p99 | 90.501 ms | 100.723 ms | 11.29 | Go-A |
| workbench.proxy.mean | 81.785 ms | 83.414 ms | 1.99 | Go-A |
| workbench.direct.min | 74.207 ms | 73.539 ms | -0.90 | Go-B |
| workbench.direct.p50 | 80.652 ms | 77.153 ms | -4.34 | Go-B |
| workbench.direct.p95 | 93.427 ms | 81.109 ms | -13.19 | Go-B |
| workbench.direct.p99 | 93.700 ms | 120.218 ms | 28.30 | Go-A |
| workbench.direct.mean | 81.490 ms | 78.730 ms | -3.39 | Go-B |

## Environment

Run A:

```json
{
  "label": "Go-A",
  "binary": "/private/tmp/claude-501/-Users-zackozack--t3-worktrees-faah-t3-cefcea1c-4c11e72aa90bee1c/0ae3e6df-8da0-4dcc-9037-24eb43d92380/scratchpad/bun-migration/bin/faah-go",
  "binaryBytes": 16914978,
  "gitCommit": "c32fe4e85b985c20d41560ab7c659e4868646e21",
  "os": "darwin 25.2.0",
  "cpu": "Apple M4",
  "cores": 10,
  "bun": "1.4.4",
  "go": "go version go1.27.3 darwin/arm64",
  "timestamp": "2026-11-13T23:23:15.926Z",
  "corpus": [
    {
      "name": "flask",
      "url": "https://github.com/pallets/flask",
      "sha": "49943b5a94413a530761350f04e896f76e8d620e"
    },
    {
      "name": "redis",
      "url": "https://github.com/redis/redis",
      "sha": "ee8e7f70152404649ac947157fd662d11b4a00d5"
    },
    {
      "name": "react",
      "url": "https://github.com/facebook/react",
      "sha": "df6aa4ec76cff5b3adde531c6fe8c36099e0469b"
    },
    {
      "name": "kubernetes",
      "url": "https://github.com/kubernetes/kubernetes",
      "sha": "29bcddace9e25a67edfb1024645e48a3eeedc5c8"
    }
  ],
  "flags": [
    "-host",
    "127.0.0.1",
    "-port",
    "0",
    "-no-open",
    "-no-update",
    "-no-color",
    "-no-lsp",
    "-no-agent",
    "-no-telemetry"
  ],
  "quick": false,
  "iterations": 30,
  "warmups": 5,
  "startupLaunches": 5,
  "throughputSeconds": 10,
  "idleSeconds": 60
}
```

Run B:

```json
{
  "label": "Go-B",
  "binary": "/private/tmp/claude-501/-Users-zackozack--t3-worktrees-faah-t3-cefcea1c-4c11e72aa90bee1c/0ae3e6df-8da0-4dcc-9037-24eb43d92380/scratchpad/bun-migration/bin/faah-go",
  "binaryBytes": 16914978,
  "gitCommit": "c32fe4e85b985c20d41560ab7c659e4868646e21",
  "os": "darwin 25.2.0",
  "cpu": "Apple M4",
  "cores": 10,
  "bun": "1.4.4",
  "go": "go version go1.27.3 darwin/arm64",
  "timestamp": "2026-11-13T23:35:34.772Z",
  "corpus": [
    {
      "name": "flask",
      "url": "https://github.com/pallets/flask",
      "sha": "49943b5a94413a530761350f04e896f76e8d620e"
    },
    {
      "name": "redis",
      "url": "https://github.com/redis/redis",
      "sha": "ee8e7f70152404649ac947157fd662d11b4a00d5"
    },
    {
      "name": "react",
      "url": "https://github.com/facebook/react",
      "sha": "df6aa4ec76cff5b3adde531c6fe8c36099e0469b"
    },
    {
      "name": "kubernetes",
      "url": "https://github.com/kubernetes/kubernetes",
      "sha": "29bcddace9e25a67edfb1024645e48a3eeedc5c8"
    }
  ],
  "flags": [
    "-host",
    "127.0.0.1",
    "-port",
    "0",
    "-no-open",
    "-no-update",
    "-no-color",
    "-no-lsp",
    "-no-agent",
    "-no-telemetry"
  ],
  "quick": false,
  "iterations": 30,
  "warmups": 5,
  "startupLaunches": 5,
  "throughputSeconds": 10,
  "idleSeconds": 60
}
```
