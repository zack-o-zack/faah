// Package codex runs OpenAI's codex CLI.
package codex

import (
	"context"
	"fmt"

	"faah/internal/agents"
)

const name = "codex"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Tools: agents.ToolsMCP} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--sandbox", "read-only")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return "" }

// Run gives a turn with tools faah's MCP server through -c, a global option
// that may come before the subcommand.
func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	argv := t.Argv
	if t.Tools != nil {
		argv = agents.InsertAfterBinary(argv, []string{
			"-c", fmt.Sprintf("mcp_servers.faah.url=%q", t.Tools.URL),
			"-c", fmt.Sprintf("mcp_servers.faah.http_headers={Authorization=%q}", "Bearer "+t.Tools.Token),
		})
	}
	return agents.Exec(ctx, name, t, argv, agents.PlainText, sink)
}
