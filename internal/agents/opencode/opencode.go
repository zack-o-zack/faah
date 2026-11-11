// Package opencode runs the opencode CLI.
package opencode

import (
	"context"
	"encoding/json"
	"fmt"

	"faah/internal/agents"
)

const name = "opencode"

// opencode has no read-only flag, so explanations run as an agent of faah's
// own, defined in OPENCODE_CONFIG_CONTENT. That config outranks the user's and
// the project's, even an agent of the same name, so neither can hand the agent
// write tools back. --standalone starts a private server that reads it; the
// shared background service loaded its config long before.
const explainAgent = "faah-explain"

var explainConfig = func() string {
	readOnly := map[string]string{"*": "deny", "read": "allow", "glob": "allow", "grep": "allow", "list": "allow"}
	b, _ := json.Marshal(map[string]any{
		"agent": map[string]any{explainAgent: map[string]any{
			"mode": "primary", "description": "Read-only explanations for faah", "permission": readOnly,
		}},
		"permission": readOnly,
	})
	return string(b)
}()

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{} }

// ReadOnly runs the turn as faah's own read-only agent, defined in
// OPENCODE_CONFIG_CONTENT.
func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	if len(argv) < 2 || argv[1] != "run" || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	out := append(argv[:2:2], append([]string{"--standalone", "--agent", explainAgent}, argv[2:]...)...)
	return out, []string{"OPENCODE_CONFIG_CONTENT=" + explainConfig}, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return "" }

func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, name, t, t.Argv, agents.PlainText, sink)
}
