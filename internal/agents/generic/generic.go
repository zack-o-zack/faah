// Package generic runs custom commands without native conversation support.
package generic

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/px0-ai/harness"

	"faah/internal/agents"
)

// Agent opens custom command sessions.
type Agent struct{ name string }

// New returns an adapter for a custom command.
func New(name string) *Agent { return &Agent{name: name} }

// Name identifies the custom command.
func (a *Agent) Name() string { return a.name }

// Open configures a custom command and refuses Plan mode.
func (a *Agent) Open(_ context.Context, o agents.Open) (agents.Session, error) {
	if o.Mode == agents.ModePlan {
		return nil, fmt.Errorf("%s: %w", a.name, agents.ErrNotReadOnly)
	}
	return &session{name: a.name, o: o}, nil
}

type session struct {
	name    string
	o       agents.Open
	turn    sync.Mutex
	mu      sync.Mutex
	cancel  context.CancelFunc
	closed  bool
	history string
}

// ID is empty because custom commands have no native session.
func (*session) ID() string { return "" }

// Prompt runs a command, retaining bounded conversation text for follow-ups.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return agents.Outcome{}, fmt.Errorf("custom session is closed")
	}
	s.cancel = cancel
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.cancel = nil; s.mu.Unlock() }()
	prompt := text
	if s.history != "" {
		prompt = "### Earlier in this conversation\n" + s.history + "### Current request\n" + text
	}
	w := &writer{sink: sink}
	r := harness.Run(ctx, harness.Command{Name: s.name, Args: s.o.Base, Model: s.o.Model}, prompt, harness.Options{Dir: s.o.Dir, Env: s.o.Env, Stdout: w, Stderr: s.o.Stderr})
	s.history += fmt.Sprintf("User: %s\n\nAssistant: %s\n\n", text, w.text.String())
	if len(s.history) > 24000 {
		s.history = s.history[len(s.history)-24000:]
	}
	return agents.Outcome{}, r.Err
}

// Interrupt cancels the running command.
func (s *session) Interrupt(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

// Close prevents further turns and cancels any running command.
func (s *session) Close() error {
	s.mu.Lock()
	s.closed = true
	if s.cancel != nil {
		s.cancel()
	}
	s.mu.Unlock()
	return nil
}

type writer struct {
	sink agents.Sink
	text strings.Builder
}

// Write forwards command output to the sink.
func (w *writer) Write(b []byte) (int, error) {
	w.text.Write(b)
	w.sink.Text(string(b), false)
	return len(b), nil
}
