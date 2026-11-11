package agents

import (
	"context"
	"io"
)

type Mode int

const (
	ModeEdit Mode = iota
	ModePlan
)

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
type Session interface {
	ID() string
	Prompt(context.Context, string, Sink) (Outcome, error)
	Interrupt(context.Context) error
	Close() error
}
