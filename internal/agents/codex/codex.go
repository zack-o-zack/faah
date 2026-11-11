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
func (*Agent) Caps() agents.Caps { return agents.Caps{} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--sandbox", "read-only")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return "" }

func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, name, t, t.Argv, agents.PlainText, sink)
}
