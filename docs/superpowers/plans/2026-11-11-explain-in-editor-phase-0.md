# Explain in the Editor, phase 0: Agent and Explain packages

Status: Done

`internal/agents` owns native `Agent`/`Open`/`Session` adapters, registered explicitly in `internal/agents/all`. `internal/codeintel` holds shared navigation, call, hover, and search types. `internal/explain` gathers evidence through a `Workspace` interface implemented by package `main`.

Protocol fakes cover every supported adapter. Package `main` retains thread persistence, HTTP handlers, selection, and changed-file reloads.

The built runtime is described in [Agent Runtime](../specs/2026-11-11-agent-runtime-design.md) and [Native agent sessions](../../internals/agents.md). The remaining display work is specified in [Explain in the Editor](../specs/2026-11-11-explain-in-editor-design.md).
