# Native agent sessions

`internal/agents` owns agent execution. `internal/agents/all` explicitly lists `claude`, `codex`, `agy`, `opencode`, and `cursor-agent`. Flags, settings, and pickers accept these names. `github.com/px0-ai/harness` supplies executable detection and model discovery.

## Interface and lifecycle

`Agent.Name` identifies an adapter. `Agent.Open(ctx, Open)` creates or resumes a native conversation and returns a `Session`. `Open` carries the workspace directory, model, Edit or Plan mode, native resume id, MCP endpoint, environment, executable argv, and diagnostic writer.

A `Session` exposes `ID`, `Prompt`, `Interrupt`, and `Close`. `Prompt` streams text, reasoning, tool steps, and a final result through `Sink`; it returns only at the protocol's completion signal. `internal/agents/host` manages process input, output, diagnostics, and shutdown.

`agent.go` keeps one live session per thread and persists its native id. A follow-up sends only the new message. Sessions close after ten idle minutes, on an agent/model/mode change, on an error, on thread deletion, and at shutdown. After a restart or idle close, faah reopens the saved native id. If resume fails, it opens a new session and sends bounded conversation history, including displayed notes and walkthroughs. Changing agent or model also starts a new session with that history.

## Processes and protocols

| Agent | Process and protocol |
| --- | --- |
| Claude | One `claude` process per session. Newline-delimited SDK control messages initialize the session, attach tools, send user messages, and interrupt. A `result` frame ends a turn. |
| Codex | One shared `codex app-server` process, released after 30 idle seconds without sessions. JSON messages use `thread/start` or `thread/resume`, `turn/start`, and `turn/interrupt`; `turn/completed` ends a turn. |
| Antigravity | One `agy acp` process per session. ACP initializes and authenticates, opens or resumes the session, and sends `session/prompt`; updates stream until the prompt response. Cancellation waits up to 15 seconds before stopping an unresponsive process. |
| OpenCode | One shared `opencode serve` process on loopback, released after 30 idle seconds without sessions. HTTP manages sessions and tools; SSE events carry output and execution completion. A random password protects the private server with HTTP Basic authentication. |
| Cursor | One Node helper per session, using `@cursor/sdk` to create or resume a local agent. JSON lines carry open, send, cancel, and close operations; SDK updates stream until `wait()` completes. |

Cursor requires Node.js 22.13 or later, npm 7 or later, and a Cursor login or `CURSOR_API_KEY`. faah installs the pinned SDK and embedded helper into its user cache, outside the workspace.

On Unix, each agent runs in a process group with a pipe watcher that stops the group when faah exits. On Windows, each agent belongs to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; closing the session terminates the job, and faah exiting closes its handle so Windows kills the tree. Assignment happens immediately after `exec.Cmd.Start`: Go does not expose the initial thread handle needed to resume a suspended child, leaving a small start-to-assignment window. A failed assignment kills and reaps the child rather than leaving it unsupervised.

After an OpenCode event-stream reconnect, running turns query `/api/session/active`, the session's durable `outcome`, and paginated projected messages back to their prompt id. Completed turns recover any missing final text; failed and interrupted turns return their native outcome. If state cannot be reconciled, the turn fails with `lost connection to opencode events` instead of waiting forever for a missed event.

## MCP and credentials

`internal/mcp` serves Streamable HTTP at `/api/mcp`, using protocol `2025-06-18`. POST requests require JSON and an Accept header listing both JSON and event streams. `initialize` returns a transport session id required on later calls; DELETE closes that transport session.

Every native thread session gets a random bearer token bound to its thread. Tokens are stored as hashes, expire after 24 idle hours, and are refreshed by requests and turns. Closing the agent session revokes its token. A token remains valid between turns, but annotate and walkthrough refuse calls unless a turn is running. Calls resolve to that thread's current running turn. Missing, expired, or revoked credentials return HTTP 401. The bearer token guards MCP independently of the browser's `localPost` checks.

`SetToolsAddr` includes faah's base path and uses loopback when faah listens on every interface. Tools attach as follows:

| Agent | Tool attachment |
| --- | --- |
| Claude | `mcp_set_servers` registers the HTTP endpoint as `faah` before any prompt. |
| Codex | `mcp_servers.faah` in native thread configuration carries the endpoint and bearer header. `omit_tools_from` keeps faah's tools out of code mode and deferred discovery. |
| Antigravity | ACP's `mcpServers` carries an HTTP entry when supported; otherwise it starts `faah acp-mcp-bridge` with endpoint and authorization environment variables. The bridge forwards MCP messages and transport headers. |
| OpenCode | `mcp.add` registers a private `faah-<thread>` remote server before each turn. `codemode: false` exposes its tools directly. Permissions deny other `faah-*` servers and allow only `<this server>_*`. |
| Cursor | SDK create/resume and send options carry an HTTP `mcpServers.faah` entry. |

## Plan mode

Explain always opens a Plan session. Inline edits, ordinary conversations, and prompt jobs use Edit mode.

| Agent | Enforcement |
| --- | --- |
| Claude | Native `plan` permission mode, a Read/Glob/Grep tool set, and control-protocol approval limited to those tools and `mcp__faah__*`. |
| Codex | Plan collaboration mode, the private `faah-plan` read-only permissions profile, untrusted approval policy, and refusal of command, file-change, and permission approvals. |
| Antigravity | Requests native plan mode when advertised. ACP permissions allow read/search/think/fetch and refuse other operations; faah advertises no filesystem or terminal capabilities. |
| OpenCode | Private `faah-plan` profile plus session rules deny `edit`, `bash`, `shell`, `webfetch`, `websearch`, and `execute`. Denying `execute` also closes its built-in HTTP `fetch` path; faah's direct MCP tools remain allowed. Permission requests are rejected. |
| Cursor | SDK `mode: "plan"` with local sandboxing enabled. |

Codex's `faah-plan` profile extends `:read-only` and denies reads of `~/.codex/rules`. In Codex 0.167.1, any denied-read restriction prevents execution-policy allow rules from bypassing the filesystem sandbox. This keeps shell-based file reading available without trusting user rules to preserve read-only execution. Both thread creation/resumption and each turn select this profile; Edit keeps the user's rules and ordinary workspace-write policy. Disabling shell and unified execution would also remove Codex's file-reading path. The rule-ignore loader option is not exposed by the app-server thread configuration.

Protocol fakes test session reuse, completion, cancellation, permissions, and MCP attachment without model calls. Real-agent conformance is opt-in under the `harness` build tag.
