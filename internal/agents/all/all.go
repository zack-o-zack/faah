// Package all lists the agents faah is built with. Adding a harness is a new
// package under internal/agents and one line here.
package all

import (
	"faah/internal/agents"
	"faah/internal/agents/agy"
	"faah/internal/agents/claude"
	"faah/internal/agents/codex"
	"faah/internal/agents/cursor"
	"faah/internal/agents/gemini"
	"faah/internal/agents/generic"
	"faah/internal/agents/opencode"
	"faah/internal/agents/percmd"
)

// List returns one of each listed agent.
func List() []agents.Agent {
	return []agents.Agent{
		claude.New(),
		codex.New(),
		agy.New(),
		opencode.New(),
		percmd.Wrap(cursor.New()),
		gemini.New(),
	}
}

// For returns the agent for a harness name, or a generic one.
func For(name string) agents.Agent {
	for _, a := range List() {
		if a.Name() == name {
			return a
		}
	}
	return percmd.Wrap(generic.New(name))
}

// CheckPlan checks whether the adapter can enforce a read-only turn.
func CheckPlan(name string, base []string) error {
	if p, ok := For(name).(*percmd.Agent); ok {
		_, _, err := p.Legacy.ReadOnly(base)
		return err
	}
	return nil
}
