# Desktop UI baseline

Reference numbers for the desktop redesign, taken 2026-11-10 on an Apple Silicon
Mac at commit `9d5cc19`, before any visual change. Compare each redesign PR
against this table. Numbers come from a production build (embedded assets) with
state isolated from the real profile.

| Measure | Baseline | Budget |
|---|---|---|
| `web/app.js` | 365,493 bytes | under +5% |
| `web/tailwind.css` | 183,208 bytes | under +5%, historical stylesheet baseline |
| Cold start to workbench loaded | 1,812 ms (median of 3) | no worse |
| First contentful paint, workbench | 656 ms (median of 3) | no worse |
| Memory, workbench idle, Electron plus backend | 368 MB (median of 5, range 359–396) | no worse |
| Open 60,000-line file | 1,390 ms | no worse |
| Scroll 60,000-line file, frame time | p50 16.7, p95 17.6, max 32.8 ms | no worse |
| Scroll 40,000-change diff, frame time | p50 16.7, p95 17.6 ms | no worse |

Scroll figures advance the scroller by 137 px per frame for 240 frames. The
fixture is one Go file of 60,000 functions with every third line changed. Cold
start and memory vary between runs, so compare medians and overlap of ranges,
not single samples. The worst single diff frame varied from 101 to 683 ms across
runs of the same build, so it is not a useful budget.

## Known issue, not caused by the redesign

Opening that 40,000-change diff takes about 34 seconds and Electron reaches about
3 GB before it renders. Typical diffs are far smaller, but this is the slowest
path found while measuring.
