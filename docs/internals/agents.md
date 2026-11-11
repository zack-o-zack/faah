# Native agent sessions

`internal/agents` owns agent execution. `internal/agents/all` explicitly lists `claude`, `codex`, `agy`, `opencode`, and `cursor-agent`. Flags, settings, and pickers accept these names. `github.com/px0-ai/harness` supplies executable detection and model discovery.

## Interface and lifecycle

`Agent.Name` identifies an adapter. `Agent.Open(ctx, Open)` creates or resumes a native conversation and returns a `Session`. `Open` carries the workspace directory, model, Edit or Ask mode, native resume id, MCP endpoint, environment, executable argv, and diagnostic writer.

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

Every native thread session gets a random bearer token bound to its thread. Tokens are stored as hashes, expire after 24 idle hours, and are refreshed by requests and turns. Closing the agent session revokes its token and removes its MCP transport sessions. Each transport is bound to its credential digest. Expiry checks remove its transports; initialization also sweeps transports with invalid credentials without refreshing their expiry. A trusted turn refresh can revive an expired credential, but discards its old transports first. A token remains valid between turns, but annotate and walkthrough refuse calls unless a turn is running. Calls resolve to that thread's current running turn. Missing, expired, or revoked credentials return HTTP 401. The bearer token guards MCP independently of the browser's `localPost` checks.

`SetToolsAddr` includes faah's base path and uses loopback when faah listens on every interface. Tools attach as follows:

| Agent | Tool attachment |
| --- | --- |
| Claude | `mcp_set_servers` registers the HTTP endpoint as `faah` before any prompt. |
| Codex | `mcp_servers.faah` in native thread configuration carries the endpoint and bearer header. `omit_tools_from` keeps faah's tools out of code mode and deferred discovery. |
| Antigravity | ACP's `mcpServers` carries an HTTP entry when supported; otherwise it starts `faah acp-mcp-bridge` with endpoint and authorization environment variables. The bridge forwards MCP messages and transport headers. |
| OpenCode | `mcp.add` registers a private `faah-<thread>` remote server before each turn. `codemode: false` exposes its tools directly. Permissions deny other `faah-*` servers and allow only `<this server>_*`. |
| Cursor | SDK create/resume and send options carry an HTTP `mcpServers.faah` entry. |

## Ask mode

Explain and its follow-ups always open an Ask session. Ask means normal agent behavior with a read-only tool allowlist, not a planning conversation. Inline edits, ordinary conversations, and prompt jobs still use Edit mode.

faah approves workspace reads and searches and its own MCP tools. It rejects requests for edits, writes, shell execution, web access, other MCP servers, and unknown tools. Paths in permission requests are checked against the workspace, including symlink targets. Native operations that do not request permission remain subject to the agent's own controls; the limitations below matter.

| Agent | Normal mode and configuration | Ask allowlist |
| --- | --- | --- |
| Claude | `--permission-mode default --tools Read,Glob,Grep` | `Read`, `Glob`, and `Grep` inside the workspace; `mcp__faah__*`. All other `can_use_tool` requests, including `ExitPlanMode`, are denied. Elicitations are declined. |
| Codex | `collaborationMode.mode: "default"`, `approvalPolicy: "untrusted"`; thread `sandbox: "read-only"` and turn `sandboxPolicy: {type: "readOnly"}` | Native reads and directly attached faah MCP tools. Every command, file-change, permission, or elicitation approval is declined. Unknown client requests fail closed. See the execution-policy limitation below. |
| Antigravity | ACP `default` mode when advertised; no client filesystem or terminal capabilities | Permission kinds `read`, `search`, `list`, and `think` within the workspace; faah MCP tools identified by their `mcp_faah_` or `mcp__faah__` namespace. `edit`, `delete`, `move`, `execute`, `fetch`, unknown kinds, and outside paths are rejected. |
| OpenCode | Normal `build` agent; session rules start with `{"action":"*","resource":"*","effect":"ask"}`, then allow `read`, `glob`, `grep`, and `list`, deny `faah-*`, and allow only `<this server>_*` | `permission.asked` receives `once` only for workspace read/search/list actions and this session's MCP tools; everything else receives `reject`. The MCP entry retains `codemode: false`, so the HTTP-capable `execute` wrapper is unnecessary. |
| Cursor | SDK `mode: "agent"`, `local.sandboxOptions: {enabled: true}`, `tools: ["read", "grep", "glob", "ls", "mcp"]` on create/resume | Only those read tools and MCP are exposed. Ask uses `local.settingSources: []` so ambient settings cannot attach other MCP servers. The pinned SDK has no tool-permission callback; these are tool restrictions, not per-call approvals. |

OpenCode no longer injects an agent or rewrites `OPENCODE_CONFIG_CONTENT`. User configuration passes through unchanged. Its v2.0.32 OpenAPI defines permission actions as extensible strings, effects as `allow`, `deny`, or `ask`, and replies as `once`, `always`, or `reject`. Installed built-in policies use `read`, `glob`, and `grep`; directory reading uses `read`. The `list` allow rule also covers a separate list action if an installed tool exposes one; OpenAPI does not enumerate a distinct built-in list permission. Session rules and permission replies retain the existing workspace boundary checks.

### Codex approval capabilities

Checked against Codex 0.167.1 with `codex app-server generate-json-schema --experimental` and the matching `rust-v0.167.1` source. The schema accepts normal collaboration mode `default`. Approval policies are `untrusted`, `on-request`, `never`, or `granular`. The granular fields are `sandbox_approval`, `rules`, `mcp_elicitations`, `request_permissions`, and `skill_approval`. They control whether existing approval flows may ask or are automatically rejected; they do not force all commands to ask or override execution-policy allow rules. No supported app-server setting was found that forces approval for every command, including allowed commands.

Ask therefore keeps `untrusted` and the read-only sandbox without a custom permissions profile. The removed profile failed workspace-requirement loading in real Codex. Shell-based reads that produce command approval requests are declined too; faah does not approve arbitrary shell commands merely because they appear to read files. Direct MCP calls have no separate tool-approval request in this version's server-request schema.

**Execution-policy limitation:** user allow rules can skip approval. The matching source does not support claiming that these commands always remain sandboxed: `core/src/exec_policy.rs` can return `Skip {bypass_sandbox: true}` for explicit allow rules, and `core/src/tools/sandboxing.rs` can honor that override when no denied-read restrictions exist. `granular` does not close this gap. A read-only sandbox is requested, but this adapter is not a strict read-only security boundary in the presence of such rules. Never promise otherwise based only on a passing explanation test.

### Antigravity permission capabilities

A no-prompt ACP probe of agy 1.5.5 (`initialize`, `authenticate`, `session/new`) advertised modes `default`, `accept-edits`, `auto`, and `plan`. The configuration options were `model`, `thought_level` (`low`, `medium`, `high`), and `mode` with the same four choices. Ask selects `default`, whose advertised behavior is to ask before edits and commands **per the user's permission settings**. None of the advertised modes or options forces every tool call to request permission independently of `toolPermission: always-proceed`. faah cannot reject a tool call that the agent does not send to `session/request_permission`; the allowlist applies to requests actually received. It never selects the planning mode as a fallback.

### Cursor SDK capabilities

Inspected the published `@cursor/sdk` 1.3.1 package typings without credentials. `AgentModeOption` offers only `agent` and `plan`, not `ask`. `AgentOptions.tools` and `disallowedTools` restrict the tools offered to the model; `mcp` is a capability group for all attached MCP tools, and `task` would permit subagents, so Ask excludes it. `tools` is a create/resume option, not a `SendOptions` field; the SDK retains it for the live agent. `SandboxOptions` exposes only `enabled`. There is no generic tool-permission callback. Executor overrides exist for read/write/grep/list/delete/shell, but their executor interfaces are not published and they are not an MCP permission mechanism. Without a callback, faah cannot independently inspect every Cursor read path. Local sandbox behavior and exclusion of ambient MCP settings remain unverified against a logged-in real Cursor session.

### Verification

Protocol fakes cover session reuse, completion, cancellation, permissions, MCP attachment, and Ask tool restrictions without model calls. Real-agent conformance is opt-in under the `harness` build tag. On November 12, 2026, Claude (haiku), OpenCode (opencode-go/claude-haiku-5-5), and Antigravity passed both explanation and attempted-write turns with zero changed files and faah annotation tool steps. Codex reached model execution but returned HTTP 401; `codex login status` reported `Not logged in`, so real Codex behavior could not be verified. Cursor was not run because no login was available. These tests do not remove the protocol limitations described above.
