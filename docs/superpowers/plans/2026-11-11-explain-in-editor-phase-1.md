# Explain in the Editor, phase 1: Explanation tools and MCP

Status: Done

`internal/mcp` serves authenticated Streamable HTTP tools and the ACP stdio bridge. Every native adapter attaches annotate and walkthrough through MCP. `internal/explain/notes` owns schemas, validation, history formatting, and finding saved notes after code moves.

Credentials belong to native sessions and resolve to the running turn. Accepted notes and walkthroughs are saved with the thread; note endpoints report text or reference staleness. Endpoint and native-session fakes test delivery without model calls.

The built runtime is described in [Agent Runtime](../specs/2026-11-11-agent-runtime-design.md) and [Native agent sessions](../../internals/agents.md). The remaining display work is specified in [Explain in the Editor](../specs/2026-11-11-explain-in-editor-design.md).
