# Agent Runtime: Design

Each agent stays running in its own server or SDK mode, and keeps a native session for each thread. faah's tools reach every agent through one MCP endpoint, attached with each agent's own mechanism. This replaces the one-command-per-turn runtime. Nothing of the old path is kept.

## What goes

- `agents.Exec`, `Agent.Run`, `TurnArgv`, `StdinArgv` and the argv rewrites for read-only.
- `explain_standby.go` (the warm-up process). A long-running agent pays its start-up once.
- Replayed prompts. Every agent has native sessions now.
- `harness.Run` for inline and batch edits. Edits run as sessions too.
- Tagged blocks (`notes.Tagged`, `ToolsTagged`) and `Caps.Tools`. Every agent has MCP.
- The `generic` adapter and custom `-agent "cmd {prompt}"` commands. `-agent` names an agent.

## Shape

```go
// internal/agents
type Agent interface {
	Name() string
	Open(ctx context.Context, o Open) (Session, error) // starts or reuses the agent's process
}

type Open struct {
	Dir      string
	Model    string
	Mode     Mode          // Edit or Plan; Plan is read-only
	Resume   string        // native session id to reopen, "" for new
	Tools    *ToolEndpoint // faah's MCP endpoint and this session's token
	Env      []string
}

type Session interface {
	ID() string                                                  // native id, persisted on the thread
	Prompt(ctx context.Context, text string, sink Sink) (Outcome, error) // one turn
	Interrupt(ctx context.Context) error
	Close() error
}
```

- A thread keeps one `Session` while faah runs and stores `Session.ID()`. After a restart it reopens with `Resume`. Live approvals do not survive a restart.
- `agents/host` owns processes: start on first use, share a process where the agent serves many sessions, close when idle, and kill the process group with faah.
- `Sink` keeps `Text`, `Step` and `Result`, and adds `Reasoning`. A turn ends on the agent's own end-of-turn signal, never on the first text.

## Tools endpoint

`internal/mcp`, served at `/api/mcp`:

- Streamable HTTP, protocol `2025-06-18`. POST only, with `Content-Type: application/json` and an `Accept` that lists both `application/json` and `text/event-stream`. A notification gets 202, and a request gets JSON. `initialize` returns an `Mcp-Session-Id`, which later requests must send. DELETE ends the session. Other methods get 405.
- Tokens: 32 random bytes, base64url. Only their SHA-256 is stored. One token per agent session, bound to its thread. The token stops working after 24 hours idle, or when the session closes or the thread is deleted. A bad token gets 401 with `{"error":"invalid_mcp_credential"}`.
- Each tool lists `readOnlyHint` from its definition.
- A tool call acts on the thread's running turn. Between turns, a call is refused.

## Agents

### claude

- `claude --output-format stream-json --verbose --input-format stream-json`, with the SDK's flags: `--permission-prompt-tool stdio`, `--permission-mode`, `--session-id <uuid>` for a new session or `--resume <id>`, `--include-partial-messages`, `--model`, and `--tools default`. One process per session, kept between turns.
- Stdin and stdout use the SDK's control protocol, one JSON object per line: `control_request`, `control_response` and `control_cancel_request`.
  - First `initialize`.
  - Then `mcp_set_servers` with `{"faah":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"},"timeout":3900000}}`. A turn is sent only after this answers, with a 90-second limit.
- A turn is a `{"type":"user","message":{"role":"user","content":…},"parent_tool_use_id":null}` line. It ends at the `result` frame. Interrupt is the `interrupt` request.
- Permissions: `can_use_tool` is answered allow or deny. Plan sets `permissionMode: "plan"`, restricts the tools to `Read`, `Glob` and `Grep`, and allows only `mcp__faah__*`. `ExitPlanMode` is denied.
- Environment: `CLAUDE_CODE_ENTRYPOINT=faah`, and `NODE_OPTIONS` is removed.

### codex

- `codex app-server`, one process shared by all of faah's codex sessions. Messages are newline-delimited, without a `jsonrpc` field, and ids count up from 1.
- `initialize` with `clientInfo {name, title, version}` and `capabilities {experimentalApi: true}`, then the `initialized` notification.
- A session is `thread/start`, or `thread/resume {threadId, excludeTurns: true}`, with `config`:
  - `"mcp_servers.faah": {url, tool_timeout_sec: 3900, http_headers: {Authorization}}`
  - `mcp_optional_startup_grace_ms: 10000`
  - The entry sets `omit_tools_from: ["code_mode", "deferred"]`, so annotate and walkthrough are called directly, not through code mode.
  - An archived thread is unarchived (`thread/unarchive`) and resumed again.
- A turn is `turn/start {threadId, input, cwd, model, approvalPolicy, sandboxPolicy, collaborationMode}` and ends at `turn/completed`. Interrupt is `turn/interrupt {threadId, turnId}`.
- Text comes from `item/agentMessage/delta`, reasoning from `item/reasoning/*Delta`, and tool steps from `item/started` and `item/completed`.
- Plan: `collaborationMode.mode: "plan"`, `approvalPolicy: "untrusted"`, `sandboxPolicy: {type: "readOnly"}`.
- Approval requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`) are answered from the mode: declined in Plan, accepted in Edit. MCP elicitations are declined.

### opencode (v2)

- One shared `opencode serve --hostname=127.0.0.1 --port=<free>` process. Its password is 32 random bytes, passed in `OPENCODE_PASSWORD` (with `OPENCODE_SERVER_PASSWORD` removed). `OPENCODE_CONFIG_CONTENT` defaults to `{}`.
  - faah is ready when the server prints `server listening on <url>` and then answers `server.info` within 5 seconds.
  - Requests use HTTP Basic auth as `opencode:<password>`.
  - The server is closed 30 seconds after its last session closes.
- Events come from the SSE stream at `/api/event` and are matched to a session by `data.sessionID`: `session.text.delta`, `session.reasoning.delta`, `session.tool.*`, and `session.execution.succeeded|failed|interrupted`, which ends the turn.
- A session is `session.create {location: {directory}, model, permissions}`, resumed with `session.get`. The agent is `plan` in Plan mode and `build` in Edit mode, set with `session.switchAgent`.
- A turn is `session.prompt {sessionID, id, text}`. Interrupt is `session.interrupt`.
- Tools, before each turn: `mcp.add {server: "faah-" + thread id, location: {directory}, config: {type: "remote", url, headers: {Authorization}, oauth: false}}`. Permission rules deny `faah-*` and allow `<name>_*`, so one thread cannot call another thread's tools.
- Permissions: `permission.asked` is answered with `permission.reply {decision: "once" | "reject"}` from the mode. Plan also denies edits in its rules.

### agy

- `agy acp`, one process per session. The environment adds `AGY_ACP_FORCE_FILE_STORAGE=1` and `PYTHONUNBUFFERED=1`.
  - agy runs with the user's own home and login.
- ACP: `initialize {protocolVersion, clientCapabilities: {fs: {readTextFile: false, writeTextFile: false}, terminal: false}, clientInfo}`, then `authenticate`, then `session/new {cwd, mcpServers}` or `session/resume {sessionId, …}`.
- `mcpServers` depends on what the agent advertises in `initialize`:
  - `mcpCapabilities.http`: `{type: "http", name: "faah", url, headers: [{name: "Authorization", value}]}`;
  - otherwise a stdio entry that runs `faah acp-mcp-bridge` with `FAAH_ACP_MCP_ENDPOINT` and `FAAH_ACP_MCP_AUTHORIZATION`.
- The bridge posts each stdin line to the endpoint as it is, keeps the `Mcp-Session-Id` it learns, and writes each answer as one stdout line.
- A turn is `session/prompt` and ends with its `stopReason`. Text comes from `session/update` `agent_message_chunk`, reasoning from `agent_thought_chunk`, and steps from `tool_call` and `tool_call_update`.
- Cancel is the `session/cancel` notification. faah waits 15 seconds for the prompt to finish, then stops the process.
- Permissions: `session/request_permission` is answered from the mode. Reads and searches are allowed. Writes are refused in Plan mode, and allowed inside the workspace in Edit mode.
- agy has no plan mode. Plan is enforced by these answers.

### cursor

- Cursor's agent runs through its SDK, `@cursor/sdk`, which is a Node package. faah ships a small Node helper: it writes the helper to its cache folder, installs `@cursor/sdk` there, and runs it with `node`, speaking one JSON object per line over stdio. The helper makes these calls:
  - `Agent.create` or `Agent.resume(agentId)` with `{model, name, mode: "plan" | "agent", local: {cwd, settingSources: ["project","user","team","mdm","plugins"], sandboxOptions: {enabled}}, mcpServers: {faah: {type: "http", url, headers: {Authorization}}}}`;
  - `.send(text, {model, mode, mcpServers, onDelta})`, `.wait()`, `.cancel()` and `.close()`.
- Its `onDelta` updates become events: `text-delta`, `thinking-delta`, and `tool-call-started|completed`.
- Cursor needs Node, npm, and a Cursor login or `CURSOR_API_KEY`. Without them it is unavailable and says why.

## Explain on the new runtime

- Explain opens a Plan session. The warm-up process is gone: a host already running for the agent is the warm start.
- The `notes` checks, saving, staleness and `/api/explain/notes` stay as they are. Only the delivery changes: every agent reaches annotate and walkthrough over MCP.
- Inline and batch edits open Edit sessions and stream into their jobs as they do today.

## Delivery

One pull request, built in this order so each step compiles and its tests pass:

1. The MCP endpoint and token registry.
2. `agents.Agent` with `Open` and `Session`, and `agents/host`.
3. claude, codex, agy and gemini, opencode, and cursor, one adapter at a time.
4. Threads, Explain and edits move onto sessions.
5. Delete `Exec`, `Run`, the standby, tagged blocks, replay, `generic`, and the per-turn contract test. Update the docs.

Explain in the Editor continues after it: orb, notes in the editor, walkthrough, ways to start. Its old phase 2 (agy over ACP) is part of this change.

## Testing

- A fake agent for each protocol, built into the test binary with Go's helper-process pattern: claude's control protocol, codex app-server, ACP, an opencode HTTP server, and the cursor helper. Each checks the session flow, turn end, interrupt, permission answers in Plan and Edit, and MCP attachment.
- Endpoint tests for the Streamable HTTP rules, tokens, session ids, DELETE, and refused calls between turns.
- The `harness` conformance test runs each real agent: a Plan explanation must make a valid tool call and change no file, and a follow-up must resume the native session.
