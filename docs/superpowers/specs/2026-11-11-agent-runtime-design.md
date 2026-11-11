# Agent Runtime: Design

Date: 2026-11-11
Status: Done

Every supported agent uses a long-running native conversation. Threads, inline and batch edits, and Explain share this runtime. The supported names are `claude`, `codex`, `agy`, `opencode`, and `cursor-agent`; flags and settings accept an agent name and a separate model choice.

## Interface

```go
type Agent interface {
    Name() string
    Open(context.Context, Open) (Session, error)
}

type Session interface {
    ID() string
    Prompt(context.Context, string, Sink) (Outcome, error)
    Interrupt(context.Context) error
    Close() error
}
```

`Open` carries the thread key, faah version, workspace directory, executable argv, environment, model, Edit or Ask mode, resume id, diagnostic writer, and MCP endpoint. `Sink` receives text, reasoning, tool steps, and final results. A turn ends on its native completion signal.

`internal/agents/all` is the explicit adapter list. Unknown names return an error listing the supported names. `github.com/px0-ai/harness` provides detection and model discovery; native adapters own execution.

## Sessions

A thread retains one live `Session` and persists its native id. Follow-ups send only the new message. Ten idle minutes close the live session; the next message resumes its saved id. Deletion, errors, shutdown, and agent/model/mode changes also close sessions. Agent and model ownership come from the last turn.

If native resume fails, faah opens a new session and sends bounded transcript history, including displayed notes and walkthroughs. A new session after an agent or model change receives the same recovery context. Prompt jobs, such as commit-message generation and Git conflict resolution, open an Edit session for the job and close it on completion.

## Process models and permissions

| Agent | Runtime | Ask enforcement |
| --- | --- | --- |
| Claude | One persistent process per session, SDK control protocol over JSON lines | Default permission mode, workspace Read/Glob/Grep, and faah MCP tools only |
| Codex | Shared `codex app-server`, native thread and turn messages | Default collaboration, untrusted approvals, read-only sandbox, and declined command/write approvals |
| Antigravity | One `agy acp` process per session, ACP requests and updates | Default mode and read/search/list/think or faah MCP permission answers |
| OpenCode | Shared authenticated `opencode serve`, HTTP requests and SSE | Normal `build` agent; ask-by-default session rules and a read/search/list plus current-server MCP allowlist |
| Cursor | One Node helper per session using the pinned `@cursor/sdk` | SDK agent mode, local sandboxing, read/MCP tool restrictions, and no ambient settings |

Ask never selects a native planning mode or adds a planning prompt. Edit behavior is unchanged. Approval callbacks fail closed for unknown tools. Codex user allow rules can bypass approval and the requested sandbox; Antigravity can skip requests under always-proceed settings; Cursor has no generic permission callback. See [Ask mode and capability limits](../../internals/agents.md#ask-mode) for the verified schemas, installed versions, and restrictions.

Shared Codex and OpenCode processes stop 30 seconds after their last session closes. Host shutdown releases process resources. Cursor's helper and SDK live in faah's user cache; Node.js 22.13+, npm 7+, and Cursor credentials are required.

## Tools

Every adapter attaches faah's MCP endpoint. Claude uses `mcp_set_servers`; Codex uses native thread configuration; Antigravity uses ACP HTTP MCP or the stdio bridge; OpenCode registers a private remote server; Cursor passes SDK `mcpServers` options.

`/api/mcp` supports Streamable HTTP initialization, JSON requests, transport session ids, notifications, and DELETE. Each native session gets a random bearer credential bound to its thread. Credentials expire after 24 idle hours and are revoked when the agent session closes. They remain valid between turns, while tool calls require a currently running turn.

OpenCode's remote MCP entry sets the supported `codemode: false` option, exposing annotate and walkthrough directly. Its `execute` wrapper includes HTTP fetch, so Ask rejects `execute` as well as web tools. Rules deny other `faah-*` endpoints and allow only the current server's tools.

Explain opens Ask sessions, supplies evidence and the reader context, and delivers annotations and walkthroughs exclusively through MCP. Validated results are saved on the running turn. Its ACP delivery phase is complete. Editor display work remains specified in [Explain in the Editor](2026-11-11-explain-in-editor-design.md).

## Validation

Protocol fakes cover each adapter's session creation, resumption, multiple turns, completion, interrupt, permission decisions, and MCP attachment. Package-main tests use native fake sessions for edits, replay recovery, and explanation tools. Endpoint tests cover credentials, transport headers, session ids, DELETE, and idle calls.

The opt-in `harness` conformance test logs the first turn's tool steps and checks real agents for valid explanation tools and unchanged files. See [native agent internals](../../internals/agents.md) for protocol and attachment details.
