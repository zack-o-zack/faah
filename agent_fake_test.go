package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"faah/internal/agents"
)

type fakePrompt func(context.Context, agents.Open, string, agents.Sink) error

type fakeAgent struct {
	prompt      fakePrompt
	resumeError error
	opens       atomic.Int64
}

// Name identifies the fake as a supported native agent.
func (*fakeAgent) Name() string { return "claude" }

// Open returns a native fake session or rejects a stale resume.
func (a *fakeAgent) Open(_ context.Context, o agents.Open) (agents.Session, error) {
	if o.Resume != "" && a.resumeError != nil {
		return nil, a.resumeError
	}
	id := o.Resume
	if id == "" {
		id = fmt.Sprintf("fake-%d", a.opens.Add(1))
	}
	return &fakeSession{agent: a, options: o, id: id}, nil
}

type fakeSession struct {
	agent   *fakeAgent
	options agents.Open
	id      string
}

// ID identifies the fake conversation.
func (s *fakeSession) ID() string { return s.id }

// Prompt runs the test callback without launching a process.
func (s *fakeSession) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	var err error
	if s.agent.prompt != nil {
		err = s.agent.prompt(ctx, s.options, text, sink)
	}
	if err == nil {
		err = ctx.Err()
	}
	return agents.Outcome{SessionID: s.id, Live: err == nil}, err
}

// Interrupt leaves cancellation to the prompt context.
func (*fakeSession) Interrupt(context.Context) error { return nil }

// Close releases the fake session.
func (*fakeSession) Close() error { return nil }

func fakeAgentServer(t *testing.T, root string, prompt fakePrompt) *Server {
	t.Helper()
	fakeCLI(t, "claude")
	s := agentServer(t, root, "claude")
	a := &fakeAgent{prompt: prompt}
	s.agent.openAgent = func(string) agents.Agent { return a }
	return s
}

func fakeReply(text string) fakePrompt {
	return func(_ context.Context, _ agents.Open, _ string, sink agents.Sink) error {
		sink.Text(text, false)
		return nil
	}
}

func fakeDelay(delay time.Duration, next fakePrompt) fakePrompt {
	return func(ctx context.Context, o agents.Open, text string, sink agents.Sink) error {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
		if next != nil {
			return next(ctx, o, text, sink)
		}
		return nil
	}
}

func fakeAppend(paths ...string) fakePrompt {
	return func(_ context.Context, o agents.Open, _ string, _ agents.Sink) error {
		for _, path := range paths {
			f, err := os.OpenFile(filepath.Join(o.Dir, path), os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				return err
			}
			_, err = f.WriteString("// touched\n")
			closeErr := f.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
		}
		return nil
	}
}

func fakeRecordPrompt(path, reply string) fakePrompt {
	return func(_ context.Context, _ agents.Open, prompt string, sink agents.Sink) error {
		sink.Text(reply, false)
		return os.WriteFile(path, []byte(prompt), 0600)
	}
}
