// Package percmd runs agents one command per turn until each has a long-running adapter.
package percmd

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"faah/internal/agents"
)

// Agent adapts a command to the session interface.
type Agent struct{ Legacy agents.Legacy }

// Wrap exposes a legacy command as a session.
func Wrap(a agents.Legacy) *Agent { return &Agent{a} }

// Name identifies the agent.
func (a *Agent) Name() string { return a.Legacy.Name() }

// Open configures a native agent session.
func (a *Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	base := o.Base
	env := o.Env
	if o.Mode == agents.ModePlan {
		var err error
		var extra []string
		base, extra, err = a.Legacy.ReadOnly(base)
		if err != nil {
			return nil, err
		}
		env = append(env, extra...)
	}
	id := o.Resume
	if id == "" {
		id = a.Legacy.NewSession(ctx, o.Dir, base)
	}
	return &session{a: a.Legacy, o: o, base: base, env: env, id: id, live: o.Resume != ""}, nil
}

type session struct {
	a         agents.Legacy
	o         agents.Open
	base, env []string
	mu        sync.Mutex
	id        string
	live      bool
	cancel    context.CancelFunc
	history   string
	turn      sync.Mutex
}

// ID returns the native conversation identifier.
func (s *session) ID() string { s.mu.Lock(); defer s.mu.Unlock(); return s.id }

// Prompt streams one turn until the agent reports completion.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.mu.Lock()
	s.cancel = cancel
	id, live := s.id, s.live
	s.mu.Unlock()
	original := text
	if !s.a.Caps().Sessions && s.history != "" {
		text = "### Earlier in this conversation\n" + s.history + "### Current request\n" + text
	}
	capture := &recordSink{Sink: sink}
	out, err := s.a.Run(ctx, agents.Turn{Dir: s.o.Dir, Argv: s.base, Env: s.env, Model: s.o.Model, Prompt: text, SessionID: id, Resume: live, Tools: s.o.Tools, Stderr: s.o.Stderr}, capture)
	s.mu.Lock()
	if s.id == "" && out.SessionID != "" {
		s.id = out.SessionID
	}
	s.live = out.Live
	s.cancel = nil
	if !s.a.Caps().Sessions {
		s.history += fmt.Sprintf("User: %s\n\nAssistant: %s\n\n", original, capture.text.String())
		if len(s.history) > 24000 {
			s.history = s.history[len(s.history)-24000:]
		}
	}
	s.mu.Unlock()
	return out, err
}

// Interrupt cancels the current turn.
func (s *session) Interrupt(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

// Close releases the session and stops its process.
func (s *session) Close() error { return s.Interrupt(context.Background()) }

type recordSink struct {
	agents.Sink
	text strings.Builder
}

// Text forwards assistant output.
func (s *recordSink) Text(t string, b bool) { s.text.WriteString(t); s.Sink.Text(t, b) }

// Result supplies an answer when no text was streamed.
func (s *recordSink) Result(t string) {
	if s.text.Len() == 0 {
		s.text.WriteString(t)
	}
	s.Sink.Result(t)
}
