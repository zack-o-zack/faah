# Backend HTTP contract

This suite freezes the Go backend at `c32fe4e85b985c20d41560ab7c659e4868646e21` so a replacement executable can preserve the frontend's HTTP and SSE contract. Tests use Bun's runner and Node-compatible standard APIs. No test dependencies were added. Git and a backend executable are required; TypeScript checking uses the repository's existing development dependencies.

Reference verification: **257 cases across 10 test files, 359 goldens, and 3/3 consecutive compare runs passed** against the same Go executable. The runs took 34.15 s, 50.47 s and 29.76 s; each made 385 assertions. Strict TypeScript checking and source formatting checks passed.

Run from the repository root (Bun 1.4.4 was used for the reference run):

```sh
FAAH_BIN=/absolute/path/to/faah bun test test/contract
./node_modules/.bin/tsc -p test/contract/tsconfig.json
```

To build the reference executable without replacing an installed faah:

```sh
npm ci # only if node_modules is missing
npm run build
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tmp/faah-go-contract .
FAAH_BIN=/tmp/faah-go-contract FAAH_CONTRACT_RECORD=1 bun test test/contract
FAAH_BIN=/tmp/faah-go-contract bun test test/contract
FAAH_BIN=/tmp/faah-go-contract bun test test/contract
FAAH_BIN=/tmp/faah-go-contract bun test test/contract
```

Record mode overwrites goldens; compare mode is the default and never updates them. Review golden diffs when recording. Run files serially with the default runner; do not add `--concurrent`, because read cases within an area share an indexed workspace. No network service, browser, installed language server, agent, or forge account is needed. Push/pull use generated local bare remotes.

## Isolation and readiness

`fixtures.ts` generates a repository in a canonical temporary path with fixed Git author, committer, dates, initial branch, configuration and content. Commit SHAs are compared exactly. The fixture has nested ignore rules, negation, anchored and directory-only patterns, ignored directories, dotfiles, Unicode names/content, CRLF, tabs, a line longer than 20,000 columns, binary/PNG inputs, empty files, and symlinks. Go, TypeScript and Python files contain multiline syntax spanning more than 1,000 lines. Markdown includes duplicate heading ids, GFM tables/tasks, footnotes, code fences and raw HTML. CSV/TSV include BOMs, quoted multiline fields and ragged rows.

Two commits establish history. The worktree then contains staged, unstaged, partially staged, untracked, deleted and renamed files. A local bare remote tracks the second commit. Each mutation test gets a fresh generated fixture; lifecycle sequences retain it only for the steps in that test. Read-only areas use one fixture per file. Temporary state is removed after stopping the backend.

The subprocess environment is an allowlist. HOME and all three XDG directories point inside the fixture's temporary directory. Git ignores system/global configuration, cannot prompt, and receives fixed dates for backend-created commits too. Credentials, developer asset overrides and user service configuration are not inherited.

`launch.ts` keeps stdin open for `-workbench-child`, parses `faah-ready`, and observes `/api/meta.ready` before taking a synchronous Git refresh. Shutdown closes stdin, with an eight-second kill fallback. Workbench uses `-desktop-host` and `faah-desktop-ready`; its child is exercised through `/w/<id>/` after the proxied index reports ready. Rendering cases observe completion while `/api/file` advertises `refine: true`, then compare the settled `exact` and `refine` fields. There are no request retries or fixed startup sleeps that conceal failures.

## Golden format and normalization

Each HTTP golden stores status, selected headers and the decoded body. Header selection includes content-type, cache-control, content-disposition, content-encoding, location, nosniff, connection and SSE buffering. Absent selected headers remain `null`. Transport Date, Content-Length, Last-Modified and ETag are outside this selection.

`transport.ts` uses HTTP directly so traversal strings and Host overrides reach the backend without URL canonicalization. It requests identity encoding by default, explicitly requests gzip in compression cases, and decompresses the wire body itself. Content-Encoding is still compared. JSON is decoded to `unknown`; text (including rendered HTML) is compared exactly; raw binary/image data uses base64. The built static JavaScript asset uses decoded SHA-256 and byte length. Identity/gzip body equality is also asserted directly for static assets, tree, Markdown, raw downloads and highlighted file windows.

`normalize.ts` is the complete normalization policy:

| Route or context                                                                                                                                        | Fields/values replaced                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every response                                                                                                                                          | Exact absolute fixture root → `<ROOT>`; remaining exact temporary-directory prefix → `<TEMP>`; exact server origin including its ephemeral port → `<ORIGIN>` |
| `/api/meta`, including proxied meta                                                                                                                     | `body.indexMs` → numeric 0; string `builtAt` → `<TIME>`; string `version` → `<VERSION>`; numeric metrics listed below → 0                                    |
| `/api/reindex`                                                                                                                                          | Numeric `indexMs` → 0                                                                                                                                        |
| `/api/metrics`, SSE `metrics`, meta's `metrics` object                                                                                                  | Numeric `rssBytes`, `peakRSSBytes`, `cpuUsage`, `goroutines`, `lspMemBytes` → 0; `lspEnabled` remains exact                                                  |
| `/api/git/refresh`, `/api/git/stage`, `/api/git/unstage`, `/api/git/log`, `/api/unpushed`, `/api/commitdetail`; SSE git payloads use the refresh policy | Relative string `date` → `<RELATIVE_DATE>` because Git computes it from the current wall clock; fixed `dateIso`, hashes and authors remain exact             |
| `/api/wb/*`                                                                                                                                             | String `version` → `<VERSION>`; numeric `lastOpened` → 0; the validated workspace id and its appearances in hrefs → `<WORKSPACE_ID>`                         |
| Proxied `/w/<id>/api/meta`                                                                                                                              | The same validated workspace id in base paths → `<WORKSPACE_ID>`                                                                                             |

No generic timestamp, id, hash or number masking exists. The covered responses have no independent pid or duration fields; add an explicit route rule if a later case exposes one. Values are normalized only when they have the expected primitive type. Arrays retain their order; object key order is irrelevant. Missing keys, null, empty arrays, booleans, string/number differences, offsets, line numbers, columns, sizes, totals, source content and HTML bytes are preserved. Relative Git dates are the only fixture commit metadata excluded from equality.

## Coverage

Paths are relative to the configured base. The static tests use `/contract/` to cover base-href rewriting and both redirect forms. The security file additionally probes methods, lexical traversal, Host/Origin checks and the save/new exceptions.

| Route                                                            | Test file                                                 | Cases include                                                                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, base without trailing slash, unknown paths                  | `static.test.ts`                                          | Exact index HTML, redirects, POST, 404                                                                                                                                      |
| `/static/themes.css`, `/static/app.js`, unknown/traversal assets | `static.test.ts`                                          | CSS bytes, asset hash/type, identity/gzip, 404/traversal                                                                                                                    |
| `/api/meta`, `/api/metrics`                                      | `index-tree.test.ts`, `static.test.ts`                    | Ready metadata, metrics, base path, gzip                                                                                                                                    |
| `/api/tree`                                                      | `index-tree.test.ts`, `mutations.test.ts`                 | Root/nested/ignored expansion, missing dir, compact all/changed/yours, rereads                                                                                              |
| `/api/find`                                                      | `index-tree.test.ts`                                      | Subsequence positions, CJK/emoji/combining marks, empty/no-hit, limit 1/0/-1/501                                                                                            |
| `/api/file`                                                      | `file-render.test.ts`                                     | Windows/edges/raw, Go/TS/Python chunks, whole-file reconstruction, CRLF/tabs/long/binary/image/deleted/missing/ignored/empty/symlink/Unicode, ref/base                      |
| `/api/raw`, `/api/close`                                         | `file-render.test.ts`                                     | Raw bytes/disposition, ignored ref, missing, query-shaped POST close                                                                                                        |
| `/api/markdown`                                                  | `file-render.test.ts`                                     | Rich exact HTML, 413, 415, 404, gzip                                                                                                                                        |
| `/api/table`                                                     | `file-render.test.ts`                                     | BOM, quoted multiline cells, ragged rows, TSV, empty, malformed quotes accepted, 415/404; see 422 limitation below                                                          |
| `/api/outline`, `/api/def`                                       | `file-render.test.ts`                                     | Go/TS/Python/Markdown outlines, empty/missing symbols, declarations vs references                                                                                           |
| `/api/search`                                                    | `search.test.ts`                                          | Literal/regex/case/word/glob, ignored exact-file glob, Unicode literal vs regex fold, no-hit/empty/invalid regex, 50-match and 200-file boundaries                          |
| `/api/reindex`                                                   | `index-tree.test.ts`, `search.test.ts`                    | POST rebuild and newly generated file indexing                                                                                                                              |
| `/api/file/save`, `/api/fs/new`                                  | `mutations.test.ts`, `security.test.ts`                   | Save, parent creation, new dir/file, 409, file/tree rereads, Origin/Host exceptions                                                                                         |
| `/api/git/refresh`                                               | `git.test.ts`                                             | Complete status/staging/partial/rename/deletion payload                                                                                                                     |
| `/api/diff`, `/api/gutter`                                       | `git.test.ts`                                             | Working tree, staged/partial/deleted/renamed/untracked, ref and base commit variants                                                                                        |
| `/api/git/stage`, `/api/git/unstage`                             | `git.test.ts`                                             | JSON requests, resulting status and diff                                                                                                                                    |
| `/api/git/hunk`                                                  | `git.test.ts`                                             | Stage/unstage/discard, resulting refresh and file                                                                                                                           |
| `/api/git/commit`                                                | `git.test.ts`                                             | Staged commit and automatic staging fallback, log/unpushed rereads                                                                                                          |
| `/api/git/log`, `/api/unpushed`                                  | `git.test.ts`                                             | History, limit/default, no unpushed commits, newly committed changes                                                                                                        |
| `/api/commitfiles`, `/api/commitdetail`                          | `git.test.ts`                                             | Initial/current/unknown commit, exact deterministic SHAs/stats                                                                                                              |
| `/api/git/sync-state`                                            | `git.test.ts`                                             | Tracking, ahead/behind, dirty, divergence, active merge/rebase                                                                                                              |
| `/api/git/push`, `/api/git/pull`                                 | `git.test.ts`                                             | Local bare remote, successful push/fast-forward pull, dirty and diverged 409                                                                                                |
| `/api/git/abort`                                                 | `git.test.ts`                                             | No operation, actual merge conflict, actual rebase conflict and after-state                                                                                                 |
| `/api/stream`, `/api/git/stream`                                 | `stream.test.ts`                                          | GET and POST, headers, initial metrics/git events, next git-status after save, gzip excluded                                                                                |
| `/api/settings`, `/api/session`                                  | `settings-session.test.ts`                                | GET/POST, setting map/raw/query forms, invalid JSON, session partial update and restart persistence                                                                         |
| `/api/wb/ping`, `/api/wb/state`                                  | `workbench.test.ts`                                       | Empty/running/pinned/stopped/removed state, POST reads                                                                                                                      |
| `/api/wb/browse`, `/api/wb/complete`                             | `workbench.test.ts`                                       | Hidden folders, prefix/empty/home completion, Host checks, POST reads                                                                                                       |
| `/api/wb/mkdir`                                                  | `workbench.test.ts`                                       | Parent creation and 409                                                                                                                                                     |
| `/api/wb/open`, `/w/<id>/api/meta`                               | `workbench.test.ts`                                       | Real child startup and proxied ready workspace metadata                                                                                                                     |
| `/api/wb/stop`, `/api/wb/pin`, `/api/wb/remove`                  | `workbench.test.ts`                                       | Full offline lifecycle and state rereads                                                                                                                                    |
| Workbench `/api/settings`                                        | `workbench.test.ts`                                       | Theme-only POST, rejection of extra keys and GET                                                                                                                            |
| Security/method behavior on routes above                         | `security.test.ts`, `workbench.test.ts`, `stream.test.ts` | Missing/mismatched Origin, domain Host, accepted non-loopback IP Host/scheme mismatch, G* POST acceptance, method guards, lexical traversal and controlled external symlink |

## Adding a case

Use `suite(area).case(name, route, options)` for a read. Use `mutation(area, name, async context => { ... })` for writes and record each meaningful response/reread with `capture`. A case may contain multiple requests and therefore multiple golden files. Each golden name must be unique within its area. For route params use `query`; pass simple POST fields in query parameters when the frontend's `apiPost` does, and use `{method: 'POST', json: payload}` for its `apiPostJson` callers. JSON and query forms are intentionally distinct (Git mutations and workbench use JSON; close uses a POST query).

Extend `fixtures.ts` with deterministic content before adding request cases. Avoid fixture names derived from temporary paths or wall-clock time. If a response varies, first identify the source and synchronize on the actual readiness/state transition. Add a narrowly scoped normalization rule only for a truly nondeterministic value, and document it in the table above. Record against Go, inspect statuses/body changes, then run three fresh compare processes. Do not regenerate goldens against the replacement backend to make a mismatch pass.

## Current Go oddities and limits

- `G*` routes accept POST. Workbench trusted reads also accept POST without Origin.
- Workspace stdin EOF uses Go's interrupt shutdown path and exits 130; desktop-host EOF exits 0. The launcher accepts workspace 0/130 while still rejecting a kill fallback or unexpected failure.
- File save/new enforce the method but skip `localPost`: missing Origin, cross-origin and a domain Host succeed. Other localPost routes reject those requests with exact recorded errors.
- `localPost` accepts any numeric IP Host, including a non-loopback address, and compares Origin's Host without checking its scheme.
- Path containment is lexical. Both file and raw endpoints follow a symlink into the fixture's isolated HOME outside the workspace. The test target contains controlled generated text.
- `/api/file?ref=` reads the current file and uses ref/base only for diff availability. `/api/raw` ignores ref too.
- The 50-match-per-file search cap leaves `truncated: false`. Exactly 200 matching files are golden-covered. More than 200 is excluded from exact goldens: concurrent workers race to claim the cap, so both the selected files and `truncated` may vary. Normalizing away those results would hide real contract differences.
- `/api/table` enables `LazyQuotes` and disables field-count validation. Unterminated and stray quotes and ragged rows are accepted. Its 422 branch requires `csv.ParseError`, but no regular-file byte input can produce the guarded quote/field-count errors under these options. The suite records malformed input returning 200; it does not fabricate a 422 or alter Go.
- Untracked Git status is `"U"`; it is distinct from Git's porcelain `?` and from the conflict status `"!"`.

Reference goldens were recorded on macOS with Unix symlinks and Git. Filesystem error text and MIME behavior may need separate platform baselines on Windows. Static hashes require the same embedded frontend build. The suite freezes settled highlighting output; it does not freeze scheduler-dependent first-pass refinement timing or assert gzip wire bytes.

## Deferred routes (future fakes)

- `/api/lsp/*`: discovery, installation, navigation, diagnostics and lifecycle, with fake language servers.
- `/api/agent/*`, `/api/threads*`, `/api/explain*`, `/api/mcp`: native process/session lifetimes, jobs, conversation events, Explain and MCP, with fake agent transports.
- `/api/pr/*`, `/api/forge/connect`, `/api/review*`: PR/forge HTTP fixtures, draft review, merge and review-workflow streams.
- `/api/git/commit-message`, `/api/git/sync-agent`: agent-assisted operations; PR-specific push/pull/force-lease paths need the forge fixtures.
- Workbench clone/PR flows and aggregate `/api/metrics`; static validators/ranges and stream heartbeat/backpressure/shutdown behavior can extend this suite later.
