# Explain in the Editor: Design

Date: 2026-11-11
Status: Runtime and tool delivery done; editor displays planned

Backlog items 3 (other displays) and 4 (walkthroughs) of [Explain This](2026-11-10-explain-this-design.md), with the delivery part of item 5 (IDE context as harness tools).

## Goal

Explanations appear on the code, not in a paragraph in the sidebar. The agent gets two tools. It uses one to explain a symbol, a line, or a block in place, and the other to guide the reader through a flow across files. The sidebar keeps the conversation and opens when the reader asks for it.

## Scope

In scope:

- The `annotate` and `walkthrough` tools, delivered over MCP to claude, codex, agy, opencode and cursor-agent in Ask mode.
- Checking, saving, and staleness of what the tools show.
- Ghost summaries and margin notes in the editor, with hover dimming.
- A walkthrough with a spotlight, keyboard and on-screen navigation, gutter badges, and a summary view.
- A progress orb while the agent works.
- An Explain action in the hover card, and an ask box next to a selection.

Out of scope:

- Nested threads for a walkthrough step. A step's "Ask" opens the sidebar conversation instead.
- IDE context tools that answer the agent (definitions, references). The MCP endpoint is built so they can be added later.
- Agents outside faah’s supported native adapter list.

## Code structure

Agent execution lives in `internal/agents`, with one adapter per supported agent and registration in `internal/agents/all`. `Agent.Open` creates or resumes a `Session`; `Session.Prompt` streams text, reasoning and steps until native completion. `Open` supplies the workspace, model, Ask mode, resume id, and MCP endpoint.

`internal/mcp` implements the endpoint, credentials, and stdio bridge. `internal/explain` gathers evidence through its `Workspace` interface, and `internal/explain/notes` checks tool arguments and locates saved notes. Package `main` owns threads and HTTP handlers. See [Agent Runtime](2026-11-11-agent-runtime-design.md) and [Native agent sessions](../../internals/agents.md) for the built interfaces and protocols.

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

Every supported agent receives annotate and walkthrough through MCP. Claude attaches the HTTP server through its control protocol; Codex configures it on the native thread; Antigravity registers it through ACP; OpenCode adds a private remote server with direct tool exposure; Cursor passes HTTP MCP options to its SDK helper.

### MCP endpoint

`/api/mcp` is an authenticated Streamable HTTP endpoint using protocol `2025-06-18`. POST handles initialization, notifications, discovery, calls, and ping; DELETE closes a transport session. Initialization returns a transport session id required by later requests.

- **Authentication:** each native session gets a random bearer credential bound to its faah thread. Credentials expire after 24 idle hours and are revoked when that agent session closes. They remain valid between turns, but tool calls require a running turn and save results on that turn.
- **Address:** agents use faah's listening address and base path, with loopback when it listens on all interfaces.
- **Tool results:** annotate validates notes independently and returns the accepted count and individual failures. Walkthrough is accepted as a whole or refused with errors for its steps. An agent can correct and retry a failed call.
- **Read-only:** every explanation and follow-up runs in a normal agent session with Ask permissions. The [agent internals](../../internals/agents.md#ask-mode) describe enforcement per agent.

### ACP bridge

Antigravity uses one `agy acp` process per session. ACP registers faah as HTTP MCP when advertised; otherwise it starts `faah acp-mcp-bridge` with `FAAH_ACP_MCP_ENDPOINT` and `FAAH_ACP_MCP_AUTHORIZATION`. The bridge forwards JSON-RPC lines, negotiates transport headers, and retains the returned MCP session id. ACP permission answers enforce read-only operations when the agent requests permission; user always-proceed settings can skip those requests.

### OpenCode tools

OpenCode registers a `faah-<thread>` remote MCP server before each turn. Its supported `codemode: false` option exposes annotate and walkthrough directly. Ask rejects requests for `webfetch`, `websearch`, and `execute`, alongside file-edit and shell actions. Rejecting `execute` blocks its built-in HTTP fetch. The thread's own MCP tools remain allowed; other faah endpoints are denied.

All agents use the same validation, saving, and staleness logic after tool delivery.

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

0. **Packages** (done). Agent adapters, evidence gathering, shared code-intelligence types, and protocol fakes.
1. **Tools and the MCP endpoint** (done). Endpoint credentials, validation, saving, staleness, prompt, and API. Notes show as a list in the thread.
2. **Native sessions and MCP for every agent** (done). Antigravity over ACP, the stdio bridge, shared native servers, and the Cursor SDK helper.
3. **Orb,** and Explain no longer opening the sidebar.
4. **Notes in the editor.** Virtual rows, ghost summaries, margin notes, hover dimming, Refresh, dismiss, and Toggle Notes.
5. **Walkthrough.** Spotlight, navigation, gutter badges, and the summary view.
6. **Ways to start.** The hover card action and the ask box.

## Testing

- **Agent contract:** protocol fakes cover native sessions, follow-ups, completion, interruption, Ask permissions, and MCP attachment.
- **Endpoint:** credentials, initialization, transport session headers, discovery, calls, notifications, DELETE, invalid arguments, and refusal of tool calls between turns.
- **Checks:** range limits, symbol snapping, length limits, workspace escape, and walkthrough step limits.
- **Saving and staleness:** a note follows moved lines, a changed text marks it outdated, a changed reference hash marks a symbol note outdated, and thread deletion removes notes.
- **ACP:** helper-process fakes cover authentication, resumption, HTTP or bridged MCP, permissions, streaming, cancellation, and follow-ups.
- **Harness conformance** (`harness` build tag): each real harness makes at least one valid tool call on a fixture, and changes no file.
- **UI:** headless Chrome screenshots for each display phase, on a fixture with a symbol, a block, and a three-file flow.
