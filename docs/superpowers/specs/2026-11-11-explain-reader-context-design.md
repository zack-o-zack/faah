# Explain Reader Context: Design

Date: 2026-11-11
Status: Implemented

Backlog item 2 of [Explain This](2026-11-10-explain-this-design.md).

## Goal

The reader tells Explain who they are and what they want, once, and every explanation is written for them. For example: "I'm new to Go, explain Go idioms in depth".

## Scope

In scope:

- One standing setting, `explain.reader`, that applies to every explanation.
- Removing the length and format limits from the explain prompt. The reader decides those.
- Marking explanations written for a different reader with a Refresh action.

Out of scope:

- A note for a single explanation.
- Reader text per workspace.
- Reader context for normal threads and inline edits.

## Setting

`explain.reader` is a free-text string in the Explain category, titled "About You", empty by default. It is stored per user in `~/.faah/settings.json` with the other settings.

## Prompt

`explainInstructions(kind, reader)` builds the first prompt of an explanation.

- The sentence "Write your first answer as one paragraph of at most 120 words, with no headings or lists." is removed.
- "Answer later questions in this conversation concisely, citing code the same way." becomes "Answer later questions in this conversation citing code the same way."
- When `reader` is not empty after trimming, the prompt adds: `The reader says about themselves: "<reader>". Shape the explanation for them.`
- The read-only rule, the rule to use the evidence first, the citation format, and the rule to say so instead of guessing stay as they are.

With no reader text, answers can be longer than before and take longer to write.

## Thread

The thread stores the reader text it was written for in a new field, `ExplainReader` (`explainReader` in JSON). `tm.explain` copies the current, trimmed setting into it when it creates an explanation thread.

`threadPrompt` passes `t.ExplainReader` to `explainInstructions`, never the live setting. A retry, or a replay after a harness switch, keeps the text the explanation started with.

## Reuse and Refresh

The explanation key does not change, so the same code still finds the same thread.

When `tm.explain` finds a matching thread whose `ExplainReader` differs from the current setting, the stale reason is `reader`. This check comes before the callers and references checks. The client labels it "Written for a different reader" and shows the Refresh action that already exists. Refresh writes a new explanation with the current setting.

Explanations made before this change have an empty `ExplainReader`. Setting the reader text for the first time therefore marks each of them with Refresh when it is next opened.

`explainPromptVersion` stays at 1, so no saved explanation is discarded.

## Testing

- `explainInstructions` with and without reader text. Neither contains a length limit.
- A new explanation stores the current setting in `ExplainReader`.
- A matching explanation opened after the setting changes is returned from the cache with stale reason `reader`.
- The prompt uses the thread's reader text after the setting changes.
- `explainStaleLabel('reader')` in the client.

## Documentation

- `docs/features/threads.md`: the answer is no longer one paragraph, and the setting is described.
- `docs/internals/threads.md`: the `ExplainReader` field and the `reader` stale reason.
- The Explain This spec: backlog item 2 marked done.
