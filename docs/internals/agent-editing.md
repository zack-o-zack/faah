# Agent editing and dispatch

`agent.go` owns selection, prompts, jobs, and changed-file detection. Inline and batch edits run through the [thread manager](threads.md); [native adapters](agents.md) own process execution and protocols.

## Discovery and selection

faah uses `github.com/px0-ai/harness` for executable detection and model discovery, filtered to `claude`, `codex`, `agy`, `opencode`, and `cursor-agent`. Models are discovered only for the selected agent. Detection runs again when the picker is loaded, so newly installed agents appear without restarting faah.

Selecting an agent saves its name and model under `$XDG_CONFIG_HOME/faah/settings.json`, or `~/.faah/settings.json`. `-agent <name>` pins that agent for the run; `-no-agent` disables dispatch. Unknown names return an error listing the supported names. A missing saved executable leaves nothing selected.

## Inline and batch edits

The selection bar, context menu, and `Alt+E` open a composer. The browser sends a path, line range, and instruction. faah reads the source from disk and composes the prompt; browser-supplied source is not trusted as the file's contents.

`/api/agent/edit` and `/api/agent/batch` call `threadManager.StartEdit`. One item creates an `edit` thread anchored to its range. Several items create a `batch` thread whose first message includes every snippet and instruction. Both use native Edit sessions and retain their transcript for follow-ups.

`threadManager.overlappingEdit` rejects overlapping ranges among running inline and batch edits with HTTP 409. Disjoint ranges can run concurrently. Uncommitted files are allowed. Ordinary conversation threads have no overlap guard, so concurrent writes can affect each other's changed-file lists.

The thread manager exposes turns as `agentJob` snapshots through the agent manager's job and cancellation hooks. `/api/agent/job?id=` serves the same shape to all edit composers. Stop cancels the native turn; changes already written remain.

## Prompt jobs

`StartPrompt(label, prompt)` supports commit messages, PR merge messages, and Git synchronization tasks without a file-range anchor. It opens an Edit session with the selected agent and model, streams output into bounded job buffers, and closes the session when the job finishes. These jobs share the id sequence and polling API with edit threads.

## Completion and reload

A native completion signal ends a turn. Before and after snapshots identify changed paths; faah does not infer them from the instruction or wait for the process to exit.

`changedSince` compares Git status plus file size and modification time, including files already dirty before the turn. The result is sorted. Outside Git, jobs report `tracked: false`, and the client reloads without relying on a changed-file list.

For changed files, `settle` evicts rendering caches and closes stale language-server documents. The browser reindexes, reloads open tabs, and redraws the tree. Source and diff views preserve their view and scroll position. Thread turns also retain before/after Git snapshots for diff review and revert; these do not move `HEAD` or modify the index.

Diagnostics and replies are kept separately. A failed composer shows the error with available stdout and stderr so the instruction can be corrected and retried.

## HTTP surface

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/agent/harnesses` | GET | Supported agents, installation state, models, and current selection |
| `/api/agent/select` | POST | Select `?name=` and optional `model`; an empty name disables selection |
| `/api/agent/edit` | POST | Dispatch a range edit; HTTP 409 for an overlapping running edit |
| `/api/agent/batch` | POST | Dispatch several anchored instructions in one thread |
| `/api/agent/job` | GET | Job snapshot by `?id=`, or the latest job |
| `/api/agent/cancel` | POST | Cancel a job by id, or all running jobs when omitted |
| `/api/git/commit-message` | POST | Generate a message from the staged diff |
| `/api/git/sync-agent` | POST | Run the requested Git synchronization task |

Browser mutations require `localPost`: POST, matching Origin and Host, and an IP or localhost host. This protects against cross-origin requests and DNS rebinding; it is not user authentication. MCP uses its own session credential rules, described in [Native agent sessions](agents.md#mcp-and-credentials).

## Limits

Thread turns have a 30-minute limit; prompt jobs use `agentTimeout`. Job stdout and stderr retain their last 32 KB. Gitignored changes do not appear in Git status. Thread history, settings, SDK helpers, and other faah state live outside the workspace.
