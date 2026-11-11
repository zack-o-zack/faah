// Package all lists the agents faah is built with. Adding a harness is a new
// package under internal/agents and one line here.
package all

import (
	"fmt"

	"faah/internal/agents"
	"faah/internal/agents/agy"
	"faah/internal/agents/claude"
	"faah/internal/agents/codex"
	"faah/internal/agents/cursor"
	"faah/internal/agents/generic"
	"faah/internal/agents/opencode"
)

// List returns one of each listed agent.
func List() []agents.Agent {
	return []agents.Agent{
		claude.New(),
		codex.New(),
		agy.New(),
		opencode.New(),
		cursor.New(),
	}
}

// For returns the agent for a harness name, or a generic one.
func For(name string) agents.Agent {
	for _, a := range List() {
		if a.Name() == name {
			return a
		}
	}
	return generic.New(name)
}

// CheckPlan refuses commands without a native Plan policy.
func CheckPlan(name string) error {
	for _, a := range List() {
		if a.Name() == name {
			return nil
		}
	}
	return fmt.Errorf("%s cannot run explanations read-only: %w", name, agents.ErrNotReadOnly)
}
