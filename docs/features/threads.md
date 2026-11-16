# Threads

A thread is a long-running conversation with your coding harness about your code. It keeps a transcript and continues the same native agent session with every message. Inline edits also become saved threads ([Agent Editing](agent-editing.md)). Use it to ask what code does, follow up on the answer, ask whether a change affects other places, and make edits across as many files as the conversation needs.

Threads live in the right sidebar, on the **Threads** tab, next to References, Symbols, Calls and Search.

## Starting a Thread

| Way | How |
| --- | --- |
| Selection | Select code and press `Alt+T`, click **Thread** in the footer selection bar, or right-click and choose **Start Thread**. |
| Line | Click the thread icon that appears beside a line number and choose **Start Thread**. |
| Current line | With nothing selected, `Alt+T` anchors the thread to the cursor line. |
| Workspace | On the Threads tab, click **+ New**, or run **Threads: Start New Thread** from the palette. The thread is not tied to any file. |

The thread opens as a draft anchored to the selected lines, shown as `path:lines` under the title. Click the anchor to jump back to that code. Nothing is created until you send the first message.

The anchor is where the conversation started, not a limit. The harness can read any file and change any file, in one turn or across many.

## The Conversation

Type in the compose box and press `Enter` to send (`Shift+Enter` for a new line). The reply streams in as the harness writes it:

- **Steps**: a collapsible list of what the harness did, such as `Read calc.go` or `Edit server.go`. It is open while the turn runs.
- **Reply**: the harness's written answer, with code blocks, inline code, bold and bullet lists rendered.
- **Changed files & Turn Review**: before and after each turn in a Git repository, faah captures an isolated worktree snapshot commit (`beforeSha` / `afterSha`) in `.git/objects` without touching `HEAD` or `.git/index`. Clicking any changed file chip opens the exact diff introduced by that turn, with a review strip to step through all files touched in that turn (`[f` / `]f`) and **Revert turn** to restore every file touched by that turn back to its pre-turn state. Open tabs reload in place when a turn that changed files finishes.

Each message continues the same conversation, so "and what about the tests?" works. While a reply is being written you can press **Stop**; whatever the harness already wrote to disk stays.

The **Model** row under the transcript is the same harness and model choice used everywhere else in faah. You can change it mid-thread: faah starts a fresh session with the new harness and hands it the earlier transcript.

There is no overlap guard. Threads and inline edits can run at the same time, on the same files, and the last write wins.

## Inline Edits Are Threads Too

[Inline edit](agent-editing.md) comment boxes live at the top of this same pane (the tab shows how many are waiting to be applied), so composing, applying and following up all happen in one place. An inline edit or batch you apply is recorded as a thread, labelled `inline` or `batch` in the list. Open it to read the agent's summary and the files it changed, or send a follow-up such as "also update the tests". These threads keep the overlap check inline edits have always had: an edit on lines another edit is still changing is refused. A conversation you start yourself is never blocked this way.

## Threads in a PR Review

In a [PR review](github-pr-review.md) a thread has a scope, picked with the **About** chips above the message box:

- **Whole PR**: the entire pull request, merge-base to PR head. This is what "the PR" means, not the latest commit.
- **My changes**: only what you have done on top of the PR, uncommitted and unpushed.
- **Selection**: just the code the thread is anchored to.

The default comes from where you started: the editor section a selection was made in (PR changes or Not pushed), then the sidebar's **PR changes / Not pushed** switch, otherwise the whole PR. You can change it at any time; the assistant is told on the next message. The assistant is given the exact git range for the scope and the diff saved as a file, so it reads the whole change instead of guessing.

## Explaining Code

Use the sparkle button beside **Edit this file** to explain the whole saved text file. It is hidden in Changes, rendered previews and images, and while editing. While that file has an explanation running, the button stays visible and is disabled. Whole-file explanations use the same settings, threads, bubble and notes as selected code. Every explain request sends only references: the workspace-relative path, line range and optional symbol name. The whole-file button sends only its path and file flag; the server derives the full range. The prompt contains source references and caller/reference locations, never workspace file contents or code excerpts. External symbols retain capped signature/documentation facts because they have no readable workspace location. The agent reads those locations with its own read tools. Whole-file targets use the same saved-file checks as selections, including the existing 8 MiB read cap. Server-side reads and hashes are used for validation and cache identity, not prompt excerpts.

Select code and press `Alt+X`, click **Explain** in the selection bar, or right-click and choose **Explain**. faah decides what you selected:

- **One identifier** explains that symbol: what it is, why it exists, and who uses it. A local variable is explained within its function.
- **Anything else, up to 400 lines,** explains what the code does, its inputs, and its effects.

The thread panel stays closed while the agent works. A small pill in the top right of the editor shows its progress, for example `Explaining · Read auth.go · 2 notes`, then `Explanation failed` or, when it is done, a translucent card with the notes count and the last paragraph of the answer cut to two lines. Click it to open the answer in the thread panel, where you can ask follow-up questions below it. The bubble stays open, including after completion or failure, until you close it with × or press Esc while it is focused. Opening its thread leaves the bubble open. Each explanation turn with notes or a walkthrough has a **Show on code** button that reopens its bubble and, when it has notes, opens the first note’s file. Inside the tool-step list, **Show notes** and **Show a walkthrough** also have buttons to reopen that turn’s bubble; the walkthrough button starts its first step. Refused calls have no button. Only one explanation bubble is open at a time. A line under the answer shows its evidence, for example `gopls · definition · 14 references in 5 files · 3 callers`. `text match` means no language server could resolve the code, so the evidence is weaker.

A walkthrough appears in a card attached under its bubble. **Start** begins the first step; **Previous** and **Next**, or ←/→ while focus is inside the bubble, move between steps and open their source files. The current step’s title appears above its code, the range has a gutter bar and a faint highlight, and other lines in that file are dimmed. Notes hide until you end the walkthrough. Other open files stay undimmed. **End**, or the first Esc, stops the steps; another Esc closes the bubble. With several walkthroughs, use the selector to choose one. Changed or clamped ranges show **may be outdated**; an unreadable step shows **file not found** without dimming code.

References to files, lines, and named symbols are links. faah checks each one when the answer finishes, and anything it cannot confirm stays plain text.

The agent can also show its explanation on the code: notes on a symbol, a line, or a block, and walkthroughs of a flow across files. Finished notes appear under the answer as collapsible code peeks. Nearby notes share a peek, and long blocks omit their middle lines. Each code line opens its file. Walkthroughs remain a list of linked steps.

Explaining the same code again reopens the earlier conversation, even if the code moved in the file. When the code changes, faah writes a new explanation. When only its callers or references change, or you changed `explain.reader` since it was written, the old one opens with a **Refresh** action. **Re-explain** always writes a new one.

`explain.reader` is added to the explain agent's prompt to describe the reader, for example `I'm new to Go`.

Explanations can run on their own harness and model: claude, codex, agy, opencode or cursor-agent. Set `explain.agent` and `explain.model` in settings, for example `claude` and `haiku`; left empty, Explain uses the harness selected for editing. When you select code, faah prepares the evidence in the background so Explain starts sooner. Turn that off with `explain.prefetch`.

Only the open bubble’s explanation turn shows notes in the editor. With no bubble open, there are no annotations. Each note appears as a single-line ghost summary above its code, outside the file text. A thin gutter bar marks the lines it explains. Hover a summary or its code to highlight that range and dim other lines. Its full Markdown detail opens as a tooltip under the summary, over the code: hover the summary for a moment, focus it, or click it or press Enter. Leaving the note, clicking again or pressing Esc closes it. The code never moves. The tooltip holds the detail and its checked code links, with no buttons. Changed code shows **outdated**, while changed references show **may be outdated**. Closing the bubble hides all its summaries, bars and panels immediately.

Explanations run in Ask mode on every supported agent and read the saved file, so save your edits first. Notes and walkthroughs arrive through faah’s MCP tools.

## The Thread List

The list shows every thread for the workspace, most recently active first, with its anchor, turn count and age. A spinner marks a thread that is working, and `!` marks one whose last reply failed. **This file** filters to threads started in the open file. The **Threads** tab shows a pulsing dot while any thread is working, so you can leave it and come back.

Threads are stored on disk and survive restarts. A reply that was still running when faah exited is marked as interrupted. You can delete a thread using the trash button in its header, by hovering over it in the thread list and clicking its trash button (or pressing `Delete`/`Backspace` when focused), or by running **Threads: Delete Current Thread** from the command palette.

## Requirements

Threads use the agent you select for editing: `claude`, `codex`, `agy`, `opencode`, or `cursor-agent`. `-agent` pins that name for the run, and `-no-agent` disables threads and agent edits. Each agent must be installed and authenticated. Cursor additionally needs Node.js 22.13 or later and npm 7 or later; faah installs its SDK helper in the user cache.

All agents keep a native session between messages. After a restart or idle close, faah resumes the saved session. If that session cannot be reopened, it starts a new one with the earlier conversation as context.
