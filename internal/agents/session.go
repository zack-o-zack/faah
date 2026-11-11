package agents

import (
	"context"
	"io"
)

// Mode selects the permissions for a session.
type Mode int

const (
	// ModeEdit permits workspace changes.
	ModeEdit Mode = iota
	// ModeAsk uses normal agent behavior and allows only workspace reads and faah tools.
	ModeAsk
)

// Open configures a native agent session.
type Open struct {
	// Key identifies the faah thread independently of the native session.
	Key     string
	Version string
	Dir     string
	Model   string
	Mode    Mode
	Resume  string
	Tools   *ToolEndpoint
	Env     []string
	Base    []string
	Stderr  io.Writer
}

// Session holds a resumable conversation.
type Session interface {
	// ID returns the native conversation identifier.
	ID() string
	// Prompt streams a turn through its native completion signal.
	Prompt(context.Context, string, Sink) (Outcome, error)
	// Interrupt stops the active turn.
	Interrupt(context.Context) error
	// Close releases the live session.
	Close() error
}
