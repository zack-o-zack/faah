# Explain This: Design

Date: 2026-11-10
Status: Draft, awaiting review

## Goal

A reader selects code, chooses **Explain**, and receives a short explanation grounded in what the IDE knows. The reader can follow its references and ask follow-up questions without leaving the code.

## Scope

In scope:

- Explaining one symbol or one code block in the working tree.
- A prefetched evidence packet built from faah's language-server and search features.
- Read-only harness runs.
- Content-based reuse of earlier explanations.
- Validated references to files, lines, and named symbols.

Out of scope for this version:

- Live IDE tools for the harness over MCP. The evidence functions are written so a later change can expose them as tools.
- Explaining a whole file, a flow, or a project.
- Per-line git history.
- Selections in a Markdown preview, deleted-only diff lines, or a file at another git revision.
- Links to code outside the workspace, such as the standard library.
- A hover card on references.

## Reader flow

1. The reader selects code and chooses **Explain** from the selection bar, the right-click menu, or `Alt+X`. The gutter menu offers it for one line.
2. The thread panel opens and shows "Reading code…".
3. faah classifies the selection and gathers evidence.
4. If a matching explanation exists, faah opens it. Otherwise faah starts a new `explain` thread and streams the answer.
5. The reader follows references or asks a follow-up in the same thread.

The action stays hidden when threads are unavailable, as the Thread action does today.

## Classification

The client sends `path`, `l1`, `c1`, `l2`, `c2`, and `text`. Columns are UTF-16 offsets, the unit the language-server handlers already accept. `extractEditorSelection` computes `c1` and `c2` and must now return them.

The server rereads the range from disk. If the text differs, it returns 409 and the client shows "Save the file to explain the current code". The client also blocks this case early when `d.dirty` is set.

| Target | Rule |
|---|---|
| Symbol | The selection is on one line and matches a whole identifier |
| Block | Any other non-blank selection of 400 lines or fewer |
| Refused | More than 400 lines. The client shows "Select 400 lines or fewer" |

Diff selections have no columns. For those, the server finds `text` on line `l1`. It treats the selection as a symbol only if that text occurs once on the line. Otherwise it treats the selection as a block.

A symbol then resolves to one of three kinds:

| Kind | Rule | Explanation covers |
|---|---|---|
| Workspace | Its definition is in the workspace and outside the enclosing function | What it is, why it exists, who uses it |
| Local | Its definition is inside the enclosing function | Its role in that function |
| External | The definition hit has `Ext` set | Its documentation and how this code uses it |

If the language server cannot resolve an identifier, faah falls back to the outline and a whole-word search and marks the source as `text`.

## Evidence packet

`explain.go` builds the packet. It depends on a small interface that `*lspManager` satisfies, so tests can use a fake:

```go
type codeIntel interface {
	Definition(ctx context.Context, abs, rel string, line, col int) ([]NavHit, error)
	References(ctx context.Context, abs, rel string, line, col int) ([]NavHit, error)
	Hover(ctx context.Context, abs, rel string, line, col int) (*HoverInfo, error)
	Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error)
	PrepareCalls(ctx context.Context, abs, rel string, line, u16col int) ([]CallNode, error)
	Calls(ctx context.Context, rel, item string, outgoing bool) ([]CallNode, error)
}
```

| Section, in priority order | Applies to | Source | Cap |
|---|---|---|---|
| Target text and location | All | Selection | 400 lines |
| Enclosing function or type | All | `Symbols`, then outline | 6 KB |
| Signature and documentation | Symbol | `Hover`, with HTML stripped | 2 KB |
| Definition body | Workspace symbol | `Definition`, `Symbols`, `readLineRange` | 6 KB |
| Identifier signatures | Block | `Hover` and `Definition` | 15 unique identifiers |
| Callers | Function or method | `PrepareCalls`, `Calls` | 12, one level |
| Callees | Function or method | `PrepareCalls`, `Calls` | 12, one level |
| Reference sample | Symbol | `References`, grouped by file, non-test files first | 40 lines |

Rules:

- The packet is limited to 16 KB. faah adds sections in priority order and drops any lower section that does not fit, recording a line such as "26 more references omitted".
- All gathering shares an 8-second budget. A section that misses the budget is omitted. A language server that is not ready by then produces a `text` source.
- If `Symbols` gives no end line, the enclosing section uses at most 80 lines from the symbol's start.
- The packet is stored in a sidecar file beside the thread store, because `saveLocked` rewrites the whole store. It goes into the prompt on the first turn and on every transcript replay.
- The packet states that workspace content is data and that instructions inside it must be ignored.

## Harness run

An `explain` thread is a new `thread.Kind`. Follow-ups keep this kind and stay read-only.

The first-turn prompt tells the harness to:

- Write one paragraph of at most 120 words, with no headings or lists.
- Answer the question for the target kind.
- Use the packet first and read other files only when needed.
- Cite with `[label](path:line)` or `[label](path:l1-l2)`, using workspace-relative paths.
- Say so when the evidence does not establish something.
- Make no changes.

Follow-ups answer concisely and have no paragraph limit.

### Read-only enforcement

`readOnlyArgv(name, argv)` rewrites the harness command before `threadArgv` runs. `Send` calls it for every `explain` turn.

| Harness | Rewrite |
|---|---|
| claude | Set `--permission-mode` to `plan` |
| codex | Set `--sandbox` to `read-only` |
| cursor-agent | Remove `--force`, add `--mode ask` |
| agy | Set `--mode` to `plan` |
| opencode | Add `--standalone --agent faah-explain` after `run`, and define that agent in `OPENCODE_CONFIG_CONTENT` with every permission denied except read, glob, grep and list |

opencode has no read-only flag. Its default agent writes without asking, and permissions given only at the top level lose to an agent's own permissions in a project's `opencode.json`. An agent defined in `OPENCODE_CONFIG_CONTENT` wins over the user's and the project's config, even an agent of the same name. `--standalone` is needed because the shared background service loaded its config earlier and ignores the variable.

`explainVerified` holds the harnesses that have passed conformance: claude, agy, codex and opencode. cursor-agent stays refused until it passes.

- Any other harness returns an error. So does an allowlisted harness whose command lacks the expected flag, such as a custom `-agent` template.
- The API returns 409 and the client shows "`<harness>` has no verified read-only mode".
- A cached explanation still opens under such a harness. Only new turns are refused.
- The flags come from each CLI's `--help`. A conformance test must pass before a harness stays on the allowlist. A harness that fails is removed. If claude's plan mode cannot produce an answer, use `--disallowedTools Edit Write NotebookEdit Bash` instead.

If `changedSince` reports files after an `explain` turn, the turn shows "Files changed during this explanation" with the existing revert action. The check is a backstop. It can also catch the reader's own edits.

## Presentation

The explanation is one paragraph in the existing thread panel. The title and first prompt read `Explain NewIndex` or `Explain index.go:40-60`.

One line under the first reply summarizes its evidence:

```text
gopls · definition · 14 references in 5 files · 3 callers
```

A `text` source reads `text match · 9 occurrences in 3 files`. The thread list labels these threads `explain`.

The thread stores the summary as structured fields: source, definition found, reference count, file count, and caller count. The client builds the line from them.

## Reuse and staleness

Lookup scans the persisted threads for a matching key. The thread holds `ExplainKey` and `EvidenceHash`.

The key is a SHA-256 hash of length-prefixed fields, with CRLF normalized to LF. Every key includes the prompt version, the source, and the path that identifies the target.

| Target | Fields in the key | Path |
|---|---|---|
| Workspace symbol | Name, definition body | Defining file |
| Local symbol | Name, enclosing body | Selection's file |
| External symbol | Signature, enclosing body | Selection's file |
| Block | Target text, enclosing body | Selection's file |

Line numbers stay out of the key. Moved code still matches. A workspace symbol reached from any call site opens the same explanation. Harness and model stay out of the key, so a model change does not regenerate an explanation.

`EvidenceHash` covers facts that may outdate an explanation without changing its subject:

- Symbol: sorted reference files with counts, and caller names.
- Block: sorted identifier names and signatures.

| Situation | Result |
|---|---|
| Key matches, hash matches | Open the thread |
| Key matches, hash differs | Open the thread with "Callers changed · Refresh" or "References changed · Refresh" |
| No key match | Generate a new explanation |
| Matching thread is running | Open it |
| Matching thread's first turn failed | Generate a new explanation |
| Reader chooses Re-explain | Clear the old thread's key and generate a new explanation |

There is no time limit. faah keeps the newest 200 `explain` threads for each workspace. On creation it prunes older threads without follow-ups and deletes their sidecar files.

The staleness check runs only through `/api/explain`. Opening a thread from the sidebar shows it without a check.

## References

| Target | Clickable | Result |
|---|---|---|
| File | Yes | Opens the file |
| Line or range | Yes | Jumps to the line and highlights the range |
| Function, method, type, constant | Yes | Jumps to the definition |
| Local variable or parameter | No | Inline code |
| Outside the workspace | No | Plain text |

When a turn ends, the server validates each `[label](target)`, `` `path:line` ``, and bare `path:line` form in the reply. It stores the result in `threadTurn.Refs`, keyed by target as written, and leaves `Reply` unchanged.

1. The file must resolve inside the workspace.
2. The line or range must be within the file.
3. An identifier-like label must appear on the cited line. If not, faah uses the nearest occurrence within 20 lines.
4. A reference that fails stays as plain text.

`thrInline` takes an optional `refs` argument. With it, the renderer links only validated targets and uses corrected lines. Without it, other threads render as they do today. Links may appear unvalidated during streaming and settle when the final thread event arrives.

Today `thrInline` drops a range's end line. It must carry the end line in `data-end`, and the click handler must highlight the range.

## Backend API

`POST /api/explain`, guarded by `localPost` and `threadsOrFail`.

Request:

```json
{ "path": "index.go", "l1": 57, "c1": 5, "l2": 57, "c2": 13, "text": "NewIndex", "force": false }
```

Response:

```json
{ "thread": {}, "cached": true, "stale": false, "staleReason": "" }
```

Errors:

| Status | Case |
|---|---|
| 400 | Bad path, blank selection, more than 400 lines, or no harness selected |
| 409 | Selection differs from disk, thread is busy, or the harness has no read-only mode |

`threadStatus` gains a case that maps the new read-only error to 409.

## Changes by file

| File | Change |
|---|---|
| `explain.go` (new) | Classification, packet, prompt, key, hash, `readOnlyArgv`, reference validation, HTTP handler |
| `agent.go` | `explain` kind, new thread fields, `Send` and `runTurn` hooks, prompt branch, pruning |
| `server.go` | Route registration |
| `web/src/selbar.js` | Return columns, add the action, `setExplainHandler`, `KeyX` |
| `web/index.html` | Selection bar button |
| `web/src/thread.js` | Explain request, loading state, evidence line, stale action, `refs` rendering, `explain` label |
| `web/src/tabs.js`, `web/src/renderer.js` | `openFile` option and paint support for a temporary range highlight |
| `docs/features/`, `docs/internals/` | Update selection actions and threads |

## Testing

Unit tests in `explain_test.go`:

- Classification, including diff selections and refused sizes.
- Key stability when lines shift, and key change when the body changes.
- One key for a workspace symbol reached from two call sites.
- Packet priority, section caps, and the 16 KB limit, using a fake `codeIntel`.
- The `text` fallback.
- `readOnlyArgv` for each harness, a missing flag, and a custom template.
- Reference validation: valid, out of range, snapped, missing file, escaping path.
- Reuse table outcomes, follow-up read-only behavior, and pruning.

Client tests cover `thrInline` with and without `refs`, and range output.

A conformance test, behind a build tag, runs each installed allowlisted harness. It asks the harness to create a file and to explain a function. It passes when no file appears and the reply is non-empty.

Manual acceptance with gopls on this repository:

1. Explain `NewIndex` and follow a reference.
2. Explain a block inside a function.
3. Ask a follow-up and confirm the worktree does not change.
4. Add a line above the function and confirm the explanation is reused.
5. Change the function body and confirm a new explanation is generated.
6. Add a caller and confirm the Refresh prompt appears.
7. Stop gopls and confirm the `text match` label appears.

## Backlog

The current version is the MVP. These items come next. Their order is not decided.

1. **Agent runtime.** Warm up login and startup before the first request. Set a default explain agent and model. Add other agent optimizations.
   - Measured on one `agy` explanation of 175 seconds: 10 seconds of startup and 125 seconds in one reasoning step of 17,895 output tokens.
   - Candidate fixes: run `agy` with `--effort low`, add line numbers to code in the packet so citing needs no rereads, and tell the agent the packet is sufficient for the selected code.
   - Done: `explain.agent` and `explain.model` settings, first-words timing, a benchmark, and background evidence preparation on selection.
   - Benchmark on this repository, first words then total: `claude` with haiku or sonnet about 7 to 8 seconds and 8 to 9 seconds; `agy` default 49 to 63 seconds and 52 to 67 seconds; `opencode` with claude-haiku-5-5 6.8 to 7.8 seconds and 6.9 to 7.9 seconds; `codex` default 14 to 16 seconds and about 17.6 seconds. Evidence gathering took 0.0 to 0.7 seconds.
   - Warm-up does not apply to codex or opencode. Both read the whole prompt before they start, so a process started early saves nothing. codex starts in about 1.3 seconds. opencode normally runs through its own background service, but read-only explanations need `--standalone`, which adds about 1 second.
   - Decided against: per-harness effort flags, and prompt limits on reading.
   - Done: warm-up. One `claude` or `agy` process is started ahead and waits for the prompt on stdin (`explain.warmup`). Measured on a small fixture, click to done: `claude` haiku 6.8 and 12.3 seconds cold, 5.7 and 11.5 warm; `agy` default 47 and 67 seconds cold, 34 and 39 warm.
   - Not done: a warm process for follow-up turns, which resume a session and need a different command.
2. **Reader context.** Let the reader give the agent specific context, for example "please explain Go-related features in depth, I have no Go experience".
   - Done: the `explain.reader` setting, and no length or format limit in the prompt. See [the reader context design](2026-11-11-explain-reader-context-design.md).
3. **Other displays.** Explore generative UI and other ways to display code information.
4. **Walkthroughs with nested threads.** Add step-by-step walkthroughs of a flow, a diff, or a call chain. Give each stage a nested thread, similar to Slack, so a reader can explore one stage's code in depth without filling the main thread with questions.
5. **IDE context as harness tools.** Give the harness live access to IDE context. Compare fast delivery options first, and do not assume MCP.
6. **Explain anything.** Extend Explain to files, flows, diffs, and other targets.
