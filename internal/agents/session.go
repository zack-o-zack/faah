package agents

import (
	"context"
	"io"
)

// Mode selects the permissions for a session.
type Mode int

const (
	ModeEdit Mode = iota
	ModePlan
)

// Open configures a native agent session.
type Open struct {
	Dir    string
	Model  string
	Mode   Mode
	Resume string
	Tools  *ToolEndpoint
	Env    []string
	Base   []string
	Stderr io.Writer
}

// Session holds a resumable conversation.
type Session interface {
	ID() string
	Prompt(context.Context, string, Sink) (Outcome, error)
	Interrupt(context.Context) error
	Close() error
}
