// Package all lists the agents faah is built with. Adding a harness is a new
// package under internal/agents and one line here.
package all

import (
	"fmt"
	"strings"

	"faah/internal/agents"
	"faah/internal/agents/agy"
	"faah/internal/agents/claude"
	"faah/internal/agents/codex"
	"faah/internal/agents/cursor"
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

// For returns the named agent, or nil when the name is unknown.
func For(name string) agents.Agent {
	for _, a := range List() {
		if a.Name() == name {
			return a
		}
	}
	return nil
}

// CheckPlan verifies that the agent has a native Plan policy.
func CheckPlan(name string) error { return ValidateName(name) }

// Names returns the supported agent names.
func Names() []string {
	names := []string{}
	for _, a := range List() {
		names = append(names, a.Name())
	}
	return names
}

// ValidateName rejects names without a native adapter.
func ValidateName(name string) error {
	if For(name) == nil {
		return fmt.Errorf("unknown agent %s; choose one of: %s", name, strings.Join(Names(), ", "))
	}
	return nil
}
