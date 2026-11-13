# Threads

This document describes the design and implementation of threads, the long-running multi-turn conversations with a coding harness:

- the store, turn runner, and event feed: [`agent.go`](../../agent.go)
- the HTTP routing and handlers: [`server.go`](../../server.go)
- the selected harness and change settling it reuses: [`agent.go`](../../agent.go)
- native agent sessions, protocol handling and Ask mode: [`internal/agents`](../../internal/agents), one package per harness, listed in [`internal/agents/all/all.go`](../../internal/agents/all/all.go)
- Explain's selection checks, evidence, prompt and citation checks: [`internal/explain`](../../internal/explain)
- the sidebar views, stream subscriptions and composer: [`web/src/threads/`](../../web/src/threads/)

Threads share agent selection, native sessions, `changedSince` and `settle`. [Inline and batch edits](agent-editing.md) are specialized threads with an overlap guard; ordinary conversations can work on any file. All thread kinds persist and support follow-ups.

## 1. Model

```mermaid
sequenceDiagram
    autonumber
    participant UI as Browser (threads/store.ts)
    participant S as faah (agent.go / server.go)
    participant H as Harness
    participant G as git

    UI->>S: GET /api/stream?thread=id (SSE)
    S-->>UI: event: thread:thread (snapshot)
    UI->>S: POST /api/threads/send {id, message}
    S->>G: gitSnapshotWorktree (beforeSHA)
    S->>H: open or reuse native session; send prompt
    H-->>S: native text, reasoning and tool events
    S-->>UI: event: delta / tool
    H-->>S: turn completion signal
    S->>G: gitSnapshotWorktree (afterSHA)
    S->>G: changedSince, settle (evict caches, close LSP docs)
    S-->>UI: event: thread (turn finished, changed files, SHAs)
    UI->>S: reindex, reload open tabs
```

A `thread` holds an id, a title (the first line of the first message), an optional anchor (`path`, `l1`, `l2`, and a `snippet` of those lines read by the server at creation), and its `turns`. A `threadTurn` holds the prompt, the accumulated `reply`, one line per tool call in `tools`, the `changed` files, an error, and the harness and model that ran it.

The anchor's snippet is read by `readLineRange` on the server, so the client never supplies file content. It is prompt context only, and the prompt says the file may have changed since.

## 2. Session Continuity

All five agents use native sessions. A thread retains a live `agents.Session` and persists `Session.ID()`. Follow-ups send only the new message. `agent_session.go` closes a session after ten idle minutes; subsequent messages reopen its saved native id. Deleting a thread, shutting down, changing agent/model/mode, or a turn error closes its live session and revokes its tool credential.

If native resume fails, faah opens a new session and replays bounded history, including the annotations and walkthroughs the reader saw. Changing agent or model also starts a new session with that context. The last turn identifies which agent and model own the saved id. The anchor, evidence and ground rules are sent on the first turn and during recovery.

See [Native agent sessions](agents.md) for the `Agent`/`Open`/`Session` interface, each process and protocol, Ask enforcement, MCP attachment.

## 3. Output and Streaming

Each adapter translates its native events into `threadSink.Text`, `Reasoning`, `Step`, and `Result`. Text streams into the reply, reasoning is kept separately, and tool activity becomes step labels. A turn finishes only on the protocol's completion event or an error. Diagnostics go to a bounded buffer and are appended to errors when a failed turn has no reply.

The feed is Server-Sent Events at `/api/threads/stream`. The browser does not open it directly: browsers allow six HTTP/1.1 connections per host across all tabs, and a stream per feature used to take them all, after which every request queued forever. Instead the same events ride on the tab's one `/api/stream` connection ([`web/src/workspace/stream.js`](../../web/src/workspace/stream.js)): `?threads=1` adds the list events as `threads:<event>`, and each `?thread=<id>` adds that thread's events as `thread:<event>` with payload `{id, data}`. A `thread=` id that no longer exists gets a `thread:deleted` on connect.

| Event | Payload | Sent to |
| --- | --- | --- |
| `thread` | full thread | `?id=` subscribers: on connect, and when a turn starts or finishes |
| `delta` | `{turn, text}` | `?id=` subscribers, as the reply grows |
| `reasoning` | `{turn, text}` | `?id=` subscribers, as reasoning grows |
| `tool` | `{turn, text}` | `?id=` subscribers |
| `list` | all summaries | list subscribers, on connect |
| `summary` | one summary | list subscribers, on any change |
| `deleted` | `{id}` | both |

`subscribe` registers the channel and takes the snapshot under one lock, so no event falls between them. A subscriber that cannot keep up (channel of 256 full) is dropped and closed, and the browser's `EventSource` reconnects to a fresh snapshot, so events are never delivered out of order. The list stream also carries `touched` (the last turn changed files or could not say), which is what makes the browser reload open tabs when a turn finishes.

## 4. Persistence

Threads are stored per workspace at `<config dir>/threads/<sha256(root)[:8]>.json`, beside `settings.json` (`$XDG_CONFIG_HOME/faah/` or `~/.faah/`), never inside the working tree. The file is written atomically (temp file, then rename) with mode `0600`, since it holds code snippets and replies.

It is saved when a turn starts, when it ends, on delete, and at most every two seconds while a reply is streaming, so an exit mid-turn loses seconds rather than the answer. On load, any turn still marked running is closed as interrupted, since its process died with faah.

## 5. Concurrency

One turn runs per thread at a time: sending to a busy thread returns `409`. Different threads, and threads alongside inline edits, run concurrently with no overlap guard: last write wins. Changing the selected agent does not alter a running turn, which already holds its session configuration. The next turn opens a session for the new selection.

Because turns can overlap, a turn's `changed` list is what differed in the worktree between its start and end, which can include a concurrent turn's or edit's changes. It is a good answer to "what moved", and a slightly generous one to "what did this turn do".

A turn is abandoned after 30 minutes (`threadTurnTimeout`). Stop cancels the turn through the native protocol; what it already wrote stays.

## 6. Inline and Batch Edits as Threads

`/api/agent/edit` and `/api/agent/batch` call `StartEdit`. One item becomes a thread of kind `edit` anchored to that range; several become a thread of kind `batch`, whose first message lists every item with its snippet and instruction. The turn then runs exactly like any other.

The edit UI polls `/api/agent/job?id=` and cancels through `/api/agent/cancel`, so threads present themselves in that shape. `threadManager.job` maps a turn to an `agentJob` (error text split into `error` and `stderr`, the reply as `stdout`), job ids come from the same sequence the agent manager uses (`nextJobID`), and the agent manager reaches the thread manager through the `threadJob` and `threadCancel` hooks. `Job(0)`, "the most recent job", returns the newer of the two kinds.

Inline edits keep their overlap guard. `overlappingEdit` refuses an edit on lines a running edit thread still covers, with the same `409` and message as before. Conversations started from the Threads pane are not part of that check, in either direction.

The first-turn prompt for these kinds asks for the change to be made and a one or two sentence summary, and a batch skips the single-anchor snippet because its message carries them.

## 6b. Worktree Turn Snapshots & Revert

To provide instant visual review and safe rollbacks of code modifications generated by a coding harness, faah isolates turn modifications using detached Git object snapshots:

1. **Before Turn**: Before sending the turn prompt, `tm.gitSnapshotWorktree()` creates an anonymous Git commit tree object in `.git/objects` representing the current working-tree state (`beforeSHA`), without modifying branch references or `.git/index`.
2. **After Turn**: Once the harness finishes execution, a second snapshot is recorded (`afterSHA`), capturing the post-turn state.
3. **Turn Diff Review**: The frontend allows users to click any changed file chip to view the exact diff introduced during that specific turn.
4. **Turn Reversion**: `POST /api/threads/revert` with `{ id, turn }` restores only the files modified during that turn using `gitCheckoutSnapshotPaths(root, turn.BeforeSHA, changedPaths)`. The turn is flagged with `reverted: true`, preserving history and transcript context while cleanly reverting working-tree files.

## 6c. Explanations

`POST /api/explain` (`explain.go`) creates a thread of `Kind: "explain"`. A harness cannot reach the language server, so faah gathers the evidence first and passes it in the prompt.

- **Classification:** `explain.Classify` rereads the selection from disk and answers 409 if it differs. One whole identifier is a symbol, and anything else is a block.
- **Evidence:** `explain.Gather` builds a packet of at most 16 KB within an 8-second budget, through the `explain.Workspace` interface, which `explainWorkspace` in `explain.go` implements over the language-server manager, search, and the workspace paths. Without a ready server it falls back to the regex outline and whole-word search. Packets live in `<store>.explain/<thread>.md`, so the thread store stays small.
- **Read-only:** every explanation and follow-up uses `agents.ModeAsk`. Each adapter uses normal agent behavior with a read/search and faah-MCP allowlist through native permissions or sandbox settings, subject to the documented protocol limitations, described in [Native agent sessions](agents.md#ask-mode). The opt-in `harness` conformance test checks real agents without becoming part of the default test suite.
- **Reuse:** `ExplainKey` hashes the content that defines the explanation and leaves out line numbers. `EvidenceHash` covers callers and references and only marks a reused explanation as stale. `ExplainReader` keeps the `explain.reader` text the explanation was written for. Its prompt always uses that copy, and when the setting no longer matches, a reused explanation is stale with reason `reader`.
- **Freshness:** gathering first syncs every open document with disk. Faah sends no file-watch events, so a change in a file the server has never opened can be missing from references and callers until that file is opened.
- **Harness:** `explainHarness` resolves `explain.agent` and `explain.model` for explain turns only. A harness pinned with `-agent` wins.
- **Prefetch:** `POST /api/explain/prepare` answers at once and gathers in a goroutine. `explainPrefetch` holds one selection; a new one cancels the one in flight. `/api/explain` uses prepared evidence only when the key (selection plus the file's size and modification time) matches and it is under 30 seconds old.
- **Timing:** `threadTurn.FirstMs` records when the first words arrived. `TestExplainBenchmark`, behind the `harness` build tag, times real explanations per harness and model.
- **Citations:** at the end of a turn `explain.ValidateRefs` fills `threadTurn.Refs`. The transcript (`lib/Markdown.tsx` with `threads/references.ts`) then links only those targets. `Reply` is left as written.
- **Tools:** every agent receives `annotate` (notes on symbols, lines or blocks) and `walkthrough` (2 to 20 steps across files) over MCP. `internal/explain/notes` validates calls, saves accepted results on the running turn, and returns what was shown or refused. `/api/mcp` uses a thread-bound session credential that remains valid between turns; tool calls require a running turn, and closing the native session revokes the credential. `SetToolsAddr` supplies the listening endpoint. See [MCP and credentials](agents.md#mcp-and-credentials) for transport headers and per-agent attachment.
- **Orb:** Explain leaves the sidebar closed and prepares the thread view behind it. [`web/src/viewers/orb-model.js`](../../web/src/viewers/orb-model.js) turns the explanation's events into the editor pill (`ExplainOrb.tsx`): the `/api/explain` reply, then `thread:thread` snapshots and `thread:tool` steps while that thread's stream is followed, and `threads:summary` to end it when another thread took over the stream. The pill is hidden while the sidebar shows the same thread. `notes.StepLabel` names annotate and walkthrough calls in words whatever prefix the agent gives them, and steps drop the workspace prefix from paths.
- **Notes:** `GET /api/explain/notes?path=` returns every note on a file, each found again with `notes.Locate` by the text it covered. A note whose text is gone stays at its saved line with `stale: "text"`. Where notes cover the same lines, the newest wins. A symbol note saves its callers and references hash (`explain.Gather`) in the background when it is added; the endpoint compares it with a hash it refreshes in the background at most every 10 seconds, and marks a change `stale: "refs"`.

## 7. HTTP Surface

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/threads` | GET | List summaries, most recent first. Also how the UI detects availability (404 with `-no-agent`). |
| `/api/threads/get` | GET | One thread by `?id=`. |
| `/api/threads/create` | POST | JSON `{path?, l1?, l2?, message}`. Creates the thread and starts its first turn. |
| `/api/threads/send` | POST | JSON `{id, message}`. `409` while a turn is running. |
| `/api/threads/cancel` | POST | Stop the running turn of `?id=`. |
| `/api/threads/scope` | POST | Update review scope in PR mode (`pr`, `mine`, `selection`). |
| `/api/threads/delete` | POST | Delete `?id=`, stopping its turn first. |
| `/api/threads/revert` | POST | Revert file changes made by a specific turn (`{id, turn}`). |
| `/api/threads/stream` | GET | SSE feed (section 3). The UI reads it through `/api/stream` instead. |
| `/api/explain` | POST | Explain a saved selection or reopen its cached thread; `force` regenerates it. |
| `/api/explain/prepare` | POST | Gather evidence for the current selection in advance. |
| `/api/explain/notes` | GET | Notes on `?path=`, found again in the file as it is now (section 6c). |
| `/api/mcp` | POST, DELETE | Authenticated Streamable HTTP MCP; initialize, discover and call tools, or close a transport session (section 6c). |

Every mutating endpoint except `/api/mcp` is guarded by `localPost`, and carries the same security posture as inline edits: it runs a general-purpose coding agent with shell access as the user who started faah.

## 8. Frontend

[`threads/store.ts`](../../web/src/threads/store.js) owns the thread list, the open thread or draft, requests and their pending and error state. The Threads sidebar (`ThreadsPanel`, `#threads-side`) shows the list (`ThreadList`) or one thread (`ThreadDetail`, `ThreadTranscript`, `ThreadTurn`). The editor's selection actions reach it through `editor.handlers.thread` (`newThread`) and `editor.handlers.explain`. The compose box uses `AgentPicker`, which reads and sets the agents store's one selection, shared with every other picker.

The store turns on the stream's `threads` topic while thread data is wanted and watches the open thread with `watchWorkspaceThread`, released when it closes; list events drive the running indicators and the tab reload. Replies render through `lib/Markdown.tsx`, which builds JSX from a parsed subset of Markdown (`lib/markdown-model.ts`: fences, inline code, emphasis, lists, citations), so a reply can never inject markup. Streamed `delta` events append to the turn in the store, and the transcript follows the end while the reader has not scrolled away.

## 8b. PR Scope

A thread in a PR session carries `scope` (`pr`, `mine`, `selection`) and `scopeSent`. `Server.prThreadContext(scope)` builds the text: the PR's number and title, then the exact range for the scope (`git diff <merge-base> <head>` for `pr`, `git diff <head>` plus the untracked files for `mine`) and the same diff written to a temp file (`prSession.writeScopeFile`, removed in `Close`). It goes in with the first prompt, with a replay, and once more whenever `scope != scopeSent`. `POST /api/threads/scope` changes it. Outside a PR session the context is empty.

## 9. Limits

- Recovery replay is bounded by `threadReplayMax`; native sessions retain their own context.
- Agent availability depends on local installation and credentials; Cursor also requires Node and npm.
- Changes to gitignored files are invisible to `git status`, so they are not listed or reloaded.
- A thread has one anchor. Moving code does not move it.
