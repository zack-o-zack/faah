// Package claude runs Claude Code.
package claude

const name = "claude"

type Agent struct{}

func New() *Agent           { return &Agent{} }
func (*Agent) Name() string { return name }
