// Package claude runs Claude Code.
package claude

const name = "claude"

// Agent opens persistent Claude conversations.
type Agent struct{}

// New returns the Claude adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return name }
