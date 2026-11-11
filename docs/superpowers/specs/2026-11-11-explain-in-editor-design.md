# Explain in the Editor: Design

Date: 2026-11-11
Status: Approved design, awaiting spec review

Backlog items 3 (other displays) and 4 (walkthroughs) of [Explain This](2026-11-10-explain-this-design.md), with the delivery part of item 5 (IDE context as harness tools).

## Goal

Explanations appear on the code, not in a paragraph in the sidebar. The agent gets two tools. It uses one to explain a symbol, a line, or a block in place, and the other to guide the reader through a flow across files. The sidebar keeps the conversation and opens when the reader asks for it.

## Scope

In scope:

- The `annotate` and `walkthrough` tools, delivered to claude, codex, agy and opencode, with every harness still read-only.
- Checking, saving, and staleness of what the tools show.
- Ghost summaries and margin notes in the editor, with hover dimming.
- A walkthrough with a spotlight, keyboard and on-screen navigation, gutter badges, and a summary view.
- A progress orb while the agent works.
- An Explain action in the hover card, and an ask box next to a selection.

Out of scope:

- Nested threads for a walkthrough step. A step's "Ask" opens the sidebar conversation instead.
- IDE context tools that answer the agent (definitions, references). The MCP endpoint is built so they can be added later.
- Harnesses other than these four.

## Code structure

Everything is in package `main` today, and harness-specific code is spread across `agent.go` and the `explain_*.go` files: session and resume flags, three output parsers, cursor's chat setup, `readOnlyArgv`, `explainEnv`, and the claude and agy standby. This work moves the agent and Explain code into packages first.

```
internal/
  agents/              one interface for every harness
    agent.go           Agent, Turn, Sink, Caps
    all/all.go         the list of compiled-in agents, one line each
    claude/            argv, stream-json, resume, plan mode, MCP config
    codex/             argv, read-only sandbox, MCP config
    agy/               one-shot, then ACP (phase 2)
    opencode/          faah-explain agent, tagged blocks
    cursor/
    gemini/
    generic/           any other harness through px0-ai/harness templates
  mcp/                 JSON-RPC handler, HTTP endpoint, tokens, stdio bridge
  acp/                 ACP client (phase 2)
  explain/             evidence, packet, prompt, link checks, selection
    notes/             annotate and walkthrough: schema, checks, store, staleness
```

### The agent interface

```go
type Agent interface {
    Name() string
    Caps() Caps // Sessions, ReadOnly, Tools (MCP, ACP, Tagged or None), Warm
    Run(ctx context.Context, t Turn, sink Sink) error
}

type Turn struct {
    Dir, Prompt, Model, SessionID string
    Resume, ReadOnly             bool
    Tools                        *ToolEndpoint // URL and token; nil means no tools
    Timeout                      time.Duration
}

type Sink interface {
    Text(s string)
    Step(label string)
    Session(id string)
}
```

- Each harness is one package. Adding one is a new folder and one line in `all/all.go`, and removing one is the reverse. The list is explicit, not registered in `init`, so what is compiled in is visible in one place.
- Harness differences stay inside the adapters. Threads and Explain call only `Agent.Run`. An adapter declares its tool channel in `Caps`, and the shared code does the rest; for example, the output of a `Tagged` agent passes through the shared block reader.
- `explain` cannot import `main`, so it defines a `Workspace` interface (`Definition`, `References`, `Callers`, `ReadFile`) that `main` implements over its language-server and index code. Agent-facing IDE tools (backlog item 5) can use the same interface later.
- Threads, `server.go`, `lsp.go`, `forge.go`, and `git.go` stay in `main` for now and call the new packages.

## Tools

### annotate

Explains code in place. One call takes a list of 1 to 100 notes, so the agent can annotate a whole file, or several files, at once. It may also call the tool again later in the answer.

`annotate({notes: [note, …]})`, where each note has:

| Field | Meaning |
|---|---|
| `kind` | `symbol`, `line`, or `block` |
| `path` | Workspace-relative file |
| `l1`, `l2` | First and last line, 1-based and inclusive. For `symbol` and `line`, the line that holds it. |
| `symbol` | The symbol's name. Required for `symbol`. |
| `summary` | One line, at most 120 characters, shown on the code |
| `detail` | Optional Markdown, shown on hover |

`symbol` and `line` show as a ghost summary. `block` shows as a margin note.

### walkthrough

Guides the reader through a flow.

| Field | Meaning |
|---|---|
| `title` | The flow's name, for example "Login request" |
| `steps` | 2 to 20 steps of `{path, l1, l2, title, body}`, in reading order |

### The prompt

The first prompt of an explanation describes both tools and says when to use each. Use `annotate` for code that can be explained where it is, and `walkthrough` for behavior that spans functions or files. The agent decides which to use and how many calls to make. Prose the agent writes outside the tools goes into the thread as the turn's reply.

## Delivery

A spike on 2026-11-11 tested each harness in the read-only mode Explain uses, on a three-file fixture. Results:

| Harness | Channel | Read-only kept by | Spike result |
|---|---|---|---|
| claude | MCP over HTTP, `--mcp-config` with `--strict-mcp-config` | `--permission-mode plan` | Both tools called, no permission prompt |
| codex | MCP over HTTP, `-c mcp_servers.faah.url=…` and `http_headers` | `--sandbox read-only` | Both tools called, no approval step |
| agy | ACP session (`agy acp`), with a stdio MCP server given in `session/new` | Plan mode through `session/set_mode`, and faah refusing every permission request that is not a faah tool | Both tools called |
| opencode | Tagged blocks in the reply | The `faah-explain` agent | All blocks valid |

opencode 2.0.32 offers MCP tools only through its `execute` tool, even with `codemode: false`. `execute` can call `fetch`, which reached a local server under the read-only agent, so opencode does not get MCP. agy's one-shot command has no way to add an MCP server for one run, which is why agy moves to ACP.

### MCP endpoint

faah's HTTP server serves `POST /api/mcp`, a Streamable HTTP MCP endpoint that answers in JSON. It handles `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, and `ping`.

- **Authentication:** each turn gets a random token, sent as `Authorization: Bearer <token>`. The token names the thread and turn, and it stops working when the turn ends. Requests without a live token get 401.
- **Address:** harnesses connect to the address faah listens on, using `127.0.0.1` when faah listens on all interfaces.
- **Tool results:** `annotate` checks each note on its own. Valid notes are shown even when others fail. The result says how many were shown and lists each failed note with what was wrong and what the nearest match is, for example `notes[3]: checkToken is not on auth.go:12; it is on line 21` or `notes[5]: auth.go:40 is past the end of the file (27 lines)`. The agent can send only the failed notes again. `walkthrough` is shown whole or not at all, and its error names each bad step.

### faah mcp-bridge

ACP only guarantees stdio MCP servers. `faah mcp-bridge` reads the endpoint and the token from its environment (`FAAH_MCP_ENDPOINT`, `FAAH_MCP_TOKEN`), and forwards each JSON-RPC line from stdin to the endpoint and each answer to stdout. agy's ACP session starts it with those two variables.

### agy over ACP

Explain runs agy through `agy acp` instead of `agy -p`.

- One `agy acp` process stays running and serves every explain session. It replaces the stdin standby for agy, and it is stopped after the same 10 minutes unused, when the explain settings change, and at shutdown.
- An explanation's first turn creates a session (`session/new` with the bridge in `mcpServers`), sets plan mode, and sends the prompt. Follow-ups use the same session while the process lives, and `session/load` after a restart.
- faah declares no file system or terminal capabilities, so agy uses its own read-only tools. Every `session/request_permission` that is not a faah tool is refused.
- `session/update` notifications feed the thread the same way stream-json does now: message chunks become the reply, and tool calls become steps.

### Tagged blocks

For opencode, the agent writes `<faah:annotate>{json}</faah:annotate>` and `<faah:walkthrough>{json}</faah:walkthrough>` on their own lines. The thread's stream reader takes each block out of the reply as soon as it closes and handles it as a tool call. A block that does not parse, or does not pass the checks, is dropped and logged, because the agent cannot be told.

All channels produce the same call value, and everything after this point is shared.

## Checks

Each call is checked before it is shown. These rules match how Explain links are checked today.

- The path is a regular file inside the workspace, with no symlink leading out of it.
- `1 ≤ l1 ≤ l2 ≤` the file's line count.
- For `symbol`, the name appears on `l1`. If it does not, the nearest line within 3 lines that has it is used. If there is none, the call is refused.
- `summary` is not empty, and is cut to 120 characters. `detail` and step bodies are cut to 4,000 characters.
- An `annotate` call has 1 to 100 notes. Each note is checked on its own, and a bad note refuses only that note.
- A walkthrough has 2 to 20 steps, and each step passes the range checks. One bad step refuses the whole call.

## Saving and staleness

Notes and walkthroughs are saved with the thread that made them, in the thread store, so they survive restarts. Deleting the thread deletes them.

Each note stores the text of its lines. When a file opens, faah finds each note's lines again by that text, so a note follows its code when lines move. A note whose text is no longer found is shown as outdated at its last known lines.

- **Symbol notes** also store a hash of the symbol's callers and references, gathered when the note is saved, in the same way as Explain's `EvidenceHash`. When a file with symbol notes opens, faah gathers the hash again in the background, at most once per note per file version. A changed hash marks the note "may be outdated".
- **Line and block notes** are outdated only when their text changes.
- An outdated note shows **Refresh**, which runs the explanation again for that note's code.

A new note on the same lines and kind replaces the old one. The reader can dismiss a single note, or hide and show all notes with **Explain: Toggle Notes**.

## Editor display

### Ghost summaries

A dimmed line drawn above the line it explains, indented like that line, for example `⟢ Turns an Authorization header into a user, or an error`. It is not part of the file. The cursor, selection, copy, and search skip it. Hovering it shows `detail`. Clicking it opens the thread in the sidebar.

The renderer has no rows between lines today. It gains "virtual rows": extra rows with a fixed height, attached above a file line, which the wrap map counts when it computes line positions.

### Margin notes

Notes in a column on the right of the editor, each aligned with the first line of its block, with a thin bracket over the block's lines. When notes would overlap, later notes move down, and a connector shows where their block starts. On narrow editors the column collapses to markers, and a note opens on hover.

### Hover dimming

Hovering a note, or the code it explains, dims every other line and highlights the note.

## Walkthrough display

- **Spotlight:** everything except the current step's lines is dimmed, and a caption card sits next to them with the step's title, body, and position, for example `3 / 7`.
- **Navigation:** `→` and `←` move between steps, and `Esc` ends the walkthrough. The card has the same actions as buttons, and progress dots that jump to a step. A step in another file opens that file.
- **Gutter badges:** numbered badges in the line-number column mark each step in the open file. Clicking one jumps to that step.
- **Summary view:** a list of all the steps, each with its title, body, and a link to its code. It opens in the sidebar from the card or the thread.
- **Ask:** the card's **Ask** button opens the sidebar conversation with the step named in the message box.

## Starting an explanation

- **Alt+X**, the selection bar, and the context menu work as today.
- **Hover card:** the language server's hover card gets an **Explain** action for the symbol under the pointer.
- **Ask box:** a small input next to the selection. The reader types a question, and submitting starts the explanation with that question and opens the sidebar conversation.
- Explain no longer opens the sidebar on its own. The orb shows progress, and the results appear on the code.

## Orb

A small indicator at the top right of the editor while an explanation runs. It shows the state and the latest step, for example `Explaining · Read auth.go · 2 notes`. It turns into a short done or failed state when the turn ends, then fades out. Clicking it opens the thread in the sidebar.

## Phases

Each phase is a pull request, based on the one before it.

0. **Refactor, no change in behavior.** `internal/agents` with one adapter per harness, `internal/explain`, and `Workspace`. The existing tests pass unchanged, and a contract test runs every agent in `all/` against a fake binary.
1. **Tools and the MCP endpoint.** The endpoint and tokens, the claude and codex channels, tagged blocks for opencode, the checks, saving, staleness, the prompt, and the API. Notes show as a plain list in the thread.
2. **agy over ACP.** The ACP client, the long-running process, `faah mcp-bridge`, and the end of the agy stdin standby.
3. **Orb,** and Explain no longer opening the sidebar.
4. **Notes in the editor.** Virtual rows, ghost summaries, margin notes, hover dimming, Refresh, dismiss, and Toggle Notes.
5. **Walkthrough.** Spotlight, navigation, gutter badges, and the summary view.
6. **Ways to start.** The hover card action and the ask box.

## Testing

- **Agent contract:** every adapter in `all/` builds a valid command for a first turn and a follow-up, parses its fixture output into text, steps, and a session id, and reports its `Caps`.
- **Endpoint:** token checks, `initialize`, `tools/list`, valid and invalid calls with their error text, an `annotate` list with some bad notes, and the token stopping at turn end.
- **Checks:** range limits, symbol snapping, length limits, workspace escape, and walkthrough step limits.
- **Tagged blocks:** blocks taken out of a streamed reply, split across chunks, invalid JSON, and invalid ranges.
- **Saving and staleness:** a note follows moved lines, a changed text marks it outdated, a changed reference hash marks a symbol note outdated, and thread deletion removes notes.
- **ACP:** a fake `agy acp` script for the session flow, plan mode, permission refusal, updates, and follow-ups.
- **Harness conformance** (`harness` build tag): each real harness makes at least one valid tool call on a fixture, and changes no file.
- **UI:** headless Chrome screenshots for each display phase, on a fixture with a symbol, a block, and a three-file flow.
