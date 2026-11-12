# Editing with Coding Agents

faah is intentionally designed as a read-optimized viewer rather than a traditional text editor. Small direct edits are possible too (see [File Editing](file-editing.md)). When code needs to be modified, faah allows you to select lines in either the source viewer or the visual diff view and delegate the edit directly to your local CLI coding agent.

---

## Overview & Core Purpose

faah sends your instruction to a supported local agent, streams its progress, and refreshes changed files when the turn finishes. Each edit keeps a native conversation, so you can follow up in its saved thread.

## Supported Agents and Models

| Agent | Name for flags and settings |
| --- | --- |
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Antigravity | `agy` |
| OpenCode | `opencode` |
| Cursor Agent | `cursor-agent` |

Choose an installed agent and one of its available models in the picker. The agent must already be authenticated. Cursor also needs Node.js 22.13+ and npm 7+; faah installs its SDK helper outside the workspace.

## How an Agent Edit Works

1. **Select Code**: Highlight the lines of code you wish to change in either the source code viewer or the visual git diff view.
2. **Trigger Composer**: Press **`Alt+E`**, right-click to open the context menu, click **Edit Inline** in the footer selection bar, or click the thread icon that appears beside a line number and choose **Edit Inline**. The comment box opens at the top of the **Threads** pane in the right sidebar, which slides open if it was closed.
3. **Configure Harness (First Time)**: Choose your preferred coding harness and model. Your choice is saved globally in `~/.faah/settings.json`, never in your repository files.
4. **Write a Comment**: Type what needs to change (e.g., *"Handle nil pointer return in error check"* or *"Refactor to use sync.Once"*). Then either **Add comment** (`Enter`) to keep it for a batch, or **Apply now** (`Ctrl/Cmd+Enter`) to run just that one straight away.
5. **Real-Time Streaming**: faah sends the file path, line range, selected code, and prompt to the harness. Progress and agent thought output stream in real time to the terminal stdout where faah was launched.
6. **Saved as a Thread**: Every edit you apply is recorded as a [thread](threads.md), labelled `inline` or `batch` in the Threads list. While an edit runs, its box and the batch bar offer **View thread** to watch it live. Open it later to see what the agent replied and which files it changed, or to ask a follow-up.
7. **Automatic Document Reload**: When the harness finishes writing to disk, faah automatically detects the modified files, refreshes the open tabs in place, updates git gutters, and preserves your scroll position. Source views stay source views; diff views stay diff views.

---

## Batching Comments

You can queue several comments and apply them together, in one coordinated run:

1. Write a comment and press **Add comment** (`Enter`). The box folds down to a single line showing your text. Click it to edit it again.
2. Select other code (or click the thread icon beside another line, then **Edit Inline**) and add another comment.
3. The **Batch** bar at the top of the Threads pane counts your comments and offers **Apply all (N)** (`Ctrl/Cmd+Shift+Enter`). Its harness and model selectors apply to the whole batch. **Clear All** discards every comment.

The bar appears as soon as the first box opens, so the batch is always in view. A batch runs as one thread whose first message lists every comment with its code, so the agent can coordinate the changes.

---

## Multi-Edit Concurrency & Safety Guards

- **Non-Overlapping Concurrency**: Multiple agent edits can run simultaneously across different files or non-overlapping line ranges within the same file. Each edit runs in its own isolated composer box.
- **Overlap Prevention**: If you attempt to dispatch an edit that overlaps with lines already being edited by an in-flight agent, faah blocks the request with a warning. This prevents competing harnesses from producing conflicted or unreviewable code.
- **Tab Close Guard**: Closing a browser tab while an agent edit is actively running prompts for confirmation, ensuring harnesses are never abandoned mid-execution.
- **Inline Error Recovery**: If an agent process fails (for example, due to an expired API key or invalid CLI argument), the error message along with process stdout and stderr is rendered inline beneath your instruction. Your instruction remains preserved so you can tweak and retry without retyping.
- **Network Sandboxing**: Agent execution is only accepted when faah is accessed via `localhost` or direct IP address. Access through remote hostnames or public tunnel domains rejects agent commands by default to prevent unauthorized execution.

---

## Beyond Code: Commit Messages

The same harness and model you pick here are also used by the sidebar git panel's **✨ Commit** (empty message) button, which asks the harness to write a commit message for your staged changes instead of editing code — see [Git Awareness: Stage, Commit, Push, Pull](git-integration.md).

---

## Keyboard Shortcuts & Controls

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| `Alt+E` | Code Selected | Open Agent Edit Composer |
| Right-Click | Code Selected | Choose "Edit with Agent" from context menu |
| Selection Bar | Code Selected | Click "Edit with Agent" button in footer |
| `Enter` | Composer Input | Dispatch instruction to agent harness |
| `Esc` | Composer Input | Cancel composer and dismiss prompt |
| Footer Badge | Status Bar | Click to switch active harness or model |

---

## Configuration Options

Agent preferences are managed in Settings (`Cmd/Ctrl+,`) or stored in `~/.faah/settings.json`:

- **Agent: Harness** (`agent.harness`): The default CLI tool to execute (`claude`, `codex`, `agy`, `opencode`, `cursor-agent`).
- **Runtime limits**: thread turns have a 30-minute limit. Native sessions close after ten idle minutes and resume on the next message.
- **CLI Flags**:
  - `faah -agent <name>`: Force a specific agent harness for the current session.
  - `faah -no-agent`: Completely disable agent editing capabilities.

---

## Technical Architecture Deep Dive

For in-depth details on native sessions, Ask mode, MCP tools, and changed-file reloads, see [Agent Dispatch](../internals/agent-editing.md) and [Native Agent Sessions](../internals/agents.md).
