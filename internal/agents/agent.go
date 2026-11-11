// Package agents runs coding harnesses behind one interface. Each harness is a
// subpackage; internal/agents/all lists the ones faah is built with.
package agents

import (
	"context"
	"errors"
)

// ErrNotReadOnly means an adapter cannot enforce Plan mode.
var ErrNotReadOnly = errors.New("no read-only mode")

// ToolEndpoint is where an MCP agent reaches faah's tools for one turn.
type ToolEndpoint struct {
	URL           string
	Authorization string
}

// Outcome is what a turn leaves behind for the next one.
type Outcome struct {
	SessionID string // the id the harness reported, "" when it reported none
	Live      bool   // the session exists now, so the next turn can resume it
}

// Sink receives a turn's output as it arrives.
type Sink interface {
	Reasoning(text string)
	Text(text string, block bool) // block marks a whole message, set off by a blank line
	Step(label string)            // a tool the harness used, such as "Read auth.go"
	Result(text string)           // the final answer, used when nothing was streamed
}

// Agent opens native coding conversations.
type Agent interface {
	Name() string
	Open(context.Context, Open) (Session, error)
}
