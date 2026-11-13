# Operational Guidelines for AI Agents

This document defines critical instructions, architectural principles, and documentation maintenance workflows for AI coding agents working on faah.

## 1. Core Architectural Tenets

1. Edits Mostly Go Through a Harness: faah does not author or format changes itself, and reads stay its hot path. The only direct writes are the user's own typed edits (`/api/file/save`) and new files or folders (`/api/fs/new`), see [`docs/internals/file-editing.md`](../internals/file-editing.md). The optional agent flow ([`agent.go`](../../agent.go)) composes an instruction anchored to a line range and hands it to a coding harness already installed on the machine; that harness performs the write, and faah reloads what moved once it exits. Several harnesses can be dispatched at once, one per non-overlapping line range: `agentManager` refuses a dispatch that overlaps a range still running. Do not add further file modification APIs that take content from the client; extend the two endpoints above instead.
1. Zero Runtime and Single Binary Footprint: Any change must compile into a single static binary (`go:embed` for web assets). Do not introduce runtime dependencies (no Node.js/npm runtime requirement, no external database, no CGO dependencies).
1. Nothing Written Into a Working Tree: faah keeps its own state (`settings.json`, and the thread store described in [`docs/internals/threads.md`](../internals/threads.md)) under the user's config directory (`$XDG_CONFIG_HOME/faah/` or `~/.faah/`), and per-workspace session files (`server.go`, PR review drafts) and the workbench store (`workbench.json`) under the state directory (`$XDG_STATE_HOME/faah/` or `~/.faah/`), never inside a workspace. There are no local `.faah/` folders or cache files in a repository. Inline edit instructions are held in memory for the life of the process; threads are persisted. *File content* is only written by a dispatched harness or by the user's own explicit save or create in the browser, never by faah on its own initiative. The one deliberate exception is *git state*: the sidebar git panel's Stage/Commit/Push/Pull (`git.go`, `server.go`) writes directly to the index, refs, and remote — but only as one explicit, user-clicked action at a time, never automatically, and Pull is fast-forward-only so it can never leave a repository mid-conflict. Do not add any other faah-authored write to a working tree; route it through the harness flow instead.
1. Performance Budgets: Indexing must complete in milliseconds using bounded concurrency (`NumCPU * 4`). File open must remain $O(1)$ relative to file length using windowed chunking (`hlChunk = 1000`) and browser DOM virtualization. Maintain explicit memory reclamation (`debug.FreeOSMemory()` on idle).

## 2. Mandatory Documentation Maintenance Protocol

Whenever modifying, adding, or refactoring code in this repository, you must audit and update the documentation accordingly:

### Documentation Mapping Matrix

| Component Modified                   | Primary Source Files                                             | Docs to Update                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| System Architecture / Optimizations  | All `.go` files, `web/src/`                                      | [`docs/internals/architecture.md`](../internals/architecture.md)                                                 |
| Indexing / Tree Walk / Gitignore     | `index.go`, `internal/ignore/ignore.go`                          | [`docs/internals/indexing-and-ignore.md`](../internals/indexing-and-ignore.md), [`README.md`](../../README.md)    |
| Fuzzy File Finder                    | `internal/fuzzy/fuzzy.go`                                        | [`docs/internals/fuzzy-search.md`](../internals/fuzzy-search.md)                                                 |
| Search / Regex / Symbol Outlines     | `search.go`, `internal/symbols/symbols.go`                       | [`docs/internals/workspace-search.md`](../internals/workspace-search.md), [`BENCHMARKS.md`](../../BENCHMARKS.md) |
| Syntax Highlighting & Lexing         | `internal/render/render.go`                                      | [`docs/internals/syntax-highlighting.md`](../internals/syntax-highlighting.md), [`README.md`](../../README.md)   |
| Language Servers (LSP)               | `lsp.go`, `server.go`                                            | [`docs/internals/lsp-and-intelligence.md`](../internals/lsp-and-intelligence.md), [`README.md`](../../README.md)|
| Git Integration & Diffing            | `git.go`                                                         | [`docs/internals/git-integration.md`](../internals/git-integration.md)                                           |
| Git Panel (Stage/Commit/Push/Pull, AI Commit Messages) | `git.go`, `agent.go` (`StartPrompt`), `server.go`, `index.go`, `web/src/git/`, `web/src/workspace/` | [`docs/internals/git-integration.md`](../internals/git-integration.md), [`docs/features/git-integration.md`](../features/git-integration.md), [`README.md`](../../README.md) |
| Unpushed Commits & Recent Commits (`@{u}..HEAD`, per-commit diffs, commit card, file paging) | `git.go`, `server.go`, `web/src/git/` (`Unpushed.jsx`, `CommitRow.jsx`, `CommitFiles.jsx`, `CommitDetails.jsx`), `web/src/workspace/`, `web/src/viewers/` (diff), `web/src/editor/documents.js` | [`docs/internals/git-integration.md`](../internals/git-integration.md), [`docs/features/git-integration.md`](../features/git-integration.md), [`README.md`](../../README.md) |
| Pull Request Review (all forges)     | `pr.go`, `forge.go` (the `GitProvider` interface), `server.go` (draft persistence), `web/src/pr/` | [`docs/internals/github-pr-review.md`](../internals/github-pr-review.md), [`docs/features/github-pr-review.md`](../features/github-pr-review.md), [`README.md`](../../README.md) |
| Forge Providers (GitHub, GitLab, Gitea/Forgejo, Bitbucket Cloud) | `forge.go`, `internal/settings/settings.go` (token settings); tests in `pr_test.go` | [`docs/internals/github-pr-review.md` §2 and "Adding a forge"](../internals/github-pr-review.md) |
| Forge Onboarding (Connect dialog, token check) | `pr.go`, `forge.go`, `web/src/pr/forge-store.js`, `web/src/pr/ForgeConnectDialog.jsx`, each provider's `TokenSetup` | [`docs/internals/github-pr-review.md` §4](../internals/github-pr-review.md), [`docs/features/pr-review-getting-started.md`](../features/pr-review-getting-started.md) |
| PR Merging, Merge Status & Rebase onto Base | `pr.go` (merge handlers, `Push(force)`), `server.go` (`prSyncState`), `agent.go` (`gitSyncPrompt`, `mergeMessagePrompt`), `web/src/pr/merge-store.js`, `web/src/pr/MergeDialog.jsx`, `web/src/git/` | [`docs/internals/github-pr-review.md`](../internals/github-pr-review.md), [`docs/features/github-pr-review.md` §6](../features/github-pr-review.md) |
| Review Workbench (bare `faah`, child workspaces, proxy, PR clones, `workbench.json`) | `workbench.go`, `pr.go` (`findPRRemote`), `main.go` (`runWorkbench`, `-workbench-child`), `web/workbench.html`, `web/tailwind.css`, `web/src/workbench/`, `web/src/app/AppShell.tsx` (back link), `web/src/pr/store.js` (opening a PR in the workbench), `scripts/build-web.js` | [`docs/internals/workbench.md`](../internals/workbench.md), [`docs/features/workbench.md`](../features/workbench.md), [`README.md`](../../README.md) |
| Harness Editing / Agent Dispatch     | `agent.go`, `agent_session.go`, `internal/agents/`, `internal/mcp/`, `internal/settings/settings.go`, `web/src/agents/`, `web/src/editor/selection-actions.js` | [`docs/internals/agent-editing.md`](../internals/agent-editing.md), [`docs/internals/agents.md`](../internals/agents.md), [`README.md`](../../README.md)                |
| Threads (multi-turn harness conversations) | `agent.go`, `internal/agents/`, `internal/explain/`, `explain*.go`, `web/src/threads/`, `web/src/agents/AgentPicker.jsx`, `web/src/viewers/ExplainOrb.jsx` | [`docs/internals/threads.md`](../internals/threads.md), [`docs/features/threads.md`](../features/threads.md), [`README.md`](../../README.md) |
| Frontend UI / Virtualization         | `web/src/` (see [`frontend.md`](../internals/frontend.md)), `web/tailwind.css` | [`docs/internals/editor-virtualization.md`](../internals/editor-virtualization.md), [`README.md`](../../README.md)|
| Markdown Preview / Table View        | `internal/render/render.go`, `internal/table/table.go`, `web/src/viewers/` (`PreviewContent.jsx`, `markdown-dom.js`, `TableViewer.jsx`) | [`docs/internals/markdown.md`](../internals/markdown.md), [`docs/internals/styling-and-themes.md`](../internals/styling-and-themes.md) |
| Themes / Colour Tokens               | `web/themes/*.css`, `web/tailwind.css`, `web/src/lib/theme.js`      | [`docs/internals/styling-and-themes.md`](../internals/styling-and-themes.md)                                    |
| User-Facing Features / Workflows    | All features, UX, and controls                                   | [`docs/features/README.md`](../features/README.md)                                                               |
| CLI Flags / Configuration            | `main.go`, `internal/settings/settings.go`                       | [`docs/features/settings-and-configuration.md`](../features/settings-and-configuration.md), [`README.md`](../../README.md)|
| Performance Metrics / Scripts        | `benchmark.sh`                                                   | [`BENCHMARKS.md`](../../BENCHMARKS.md)                                                                           |
| Release Workflow                     | `Makefile`, `build.sh`, `scripts/build-web.js`                   | [`PUBLISHING.md`](../../PUBLISHING.md)                                                                           |

## 3. Checklist for Agents Prior to Submitting Work

- Fast Inner Loop: Run `make check` or `go test -short .` for fast iteration (~10s).
- Full Verification: Ran `make test` or `go test .` and confirmed all unit/regression tests pass (`ok faah`).
- Build Integrity: Verified successful build with `make build` (or `go build -o faah .`).
- Architecture Sync: Any new optimization, algorithmic adjustment, or structural change is documented in the corresponding [`docs/internals/`](../internals/README.md) write-up.
- Flag & Shortcut Sync: Any new keyboard shortcut, UI behavior, or CLI flag is reflected in [`README.md`](../../README.md).
- Benchmark Alignment: If search, highlight, or index performance characteristics change, verify whether [`BENCHMARKS.md`](../../BENCHMARKS.md) requires updated notes or numbers.

## 4. Version Bump & Release Verification Protocol

When committing a version bump (triggered after the user updates the `VERSION` file):
1. **Verify Release Pipeline First**: Before creating the version bump commit, verify that all GitHub release scripts and build workflows are working cleanly without errors:
   - Frontend bundling: Verify `node ./scripts/build-web.js` passes with zero identifier collisions under both Bun and Node fallback.
   - Build & Cross-Compilation: Verify `go test ./...` passes and target builds in `build.sh` / `.github/workflows/release.yml` compile cleanly.
   - Release Configuration: Verify checksums, release workflow definitions, and installer compatibility.
2. **Commit Release Fixes First**: If any release scripts, bundlers, or workflow configurations need updates or fixes, make those changes and commit them in a separate commit first.
3. **Commit Version Bump**: Finally, create the version bump commit staging `VERSION` with the updated version number that the user started with (following the `ape-commit` format).

## 5. Frontend Architecture & Code Map for Agents

The browser UI is a Solid app under [`web/src/`](../../web/src/). [`web/index.html`](../../web/index.html) is only a mount point with fonts and stylesheets; `web/src/main.jsx` renders the page into it. [`docs/internals/frontend.md`](../internals/frontend.md) is the code map: the directory table, the store slices and their owners, the action surface, start-up, the event stream, shortcut and command registries, and the lint guards.

To find a feature's code, start from its directory (`editor/`, `viewers/`, `workspace/`, `git/`, `review/`, `pr/`, `threads/`, `agents/`, `inspector/`, `palette/`, `settings/`, `shortcuts/`, `layout/`, `status/`). Each has a `store.js` or `actions.js` for state and named actions, `logic.js` for pure, tested functions, and one JSX component per file. Element ids used by the stylesheet (`#main`, `#editor`, `#viewport`, `#tab-row`, `#empty`, `#review-view` and others) are set in those components; search for the id to find its owner.
