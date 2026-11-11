// Package gemini runs Gemini CLI sessions over ACP.
package gemini

import (
	"context"

	"faah/internal/agents"
	"faah/internal/agents/acp"
)

// Agent opens native Gemini conversations.
type Agent struct{}

// New returns the Gemini adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return "gemini" }

// Open starts or resumes a persistent conversation.
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	return acp.Open(ctx, o, acp.Args(o.Base, "gemini"), nil, nil, true)
}
