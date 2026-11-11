// Package generic runs any harness faah has no adapter for: plain text, no
// sessions, no read-only mode.
package generic

import (
	"context"
	"fmt"

	"faah/internal/agents"
)

type Agent struct{ name string }

func New(name string) *Agent { return &Agent{name: name} }

func (a *Agent) Name() string    { return a.name }
func (*Agent) Caps() agents.Caps { return agents.Caps{} }

func (a *Agent) ReadOnly([]string) ([]string, []string, error) {
	return nil, nil, fmt.Errorf("%s has %w", a.name, agents.ErrNotReadOnly)
}

func (*Agent) NewSession(context.Context, string, []string) string { return "" }

func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, a.name, t, t.Argv, agents.PlainText, sink)
}
