// Package threadstest provides shared native agent fixtures for thread and host tests.
package threadstest

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"faah/internal/agents"
)

type Prompt func(context.Context, agents.Open, string, agents.Sink) error

type Agent struct {
	PromptFunc  Prompt
	ResumeError error
	opens       atomic.Int64
}

// Name identifies the fake as a supported native agent.
func (*Agent) Name() string { return "claude" }

// Open returns a native fake session or rejects a stale resume.
func (a *Agent) Open(_ context.Context, o agents.Open) (agents.Session, error) {
	if o.Resume != "" && a.ResumeError != nil {
		return nil, a.ResumeError
	}
	id := o.Resume
	if id == "" {
		id = fmt.Sprintf("fake-%d", a.opens.Add(1))
	}
	return &session{agent: a, options: o, id: id}, nil
}

type session struct {
	agent   *Agent
	options agents.Open
	id      string
}

// ID identifies the fake conversation.
func (s *session) ID() string { return s.id }

// Prompt runs the test callback without launching a process.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	var err error
	if s.agent.PromptFunc != nil {
		err = s.agent.PromptFunc(ctx, s.options, text, sink)
	}
	if err == nil {
		err = ctx.Err()
	}
	return agents.Outcome{SessionID: s.id, Live: err == nil}, err
}

// Interrupt leaves cancellation to the prompt context.
func (*session) Interrupt(context.Context) error { return nil }

// Close releases the fake session.
func (*session) Close() error { return nil }

func Reply(text string) Prompt {
	return func(_ context.Context, _ agents.Open, _ string, sink agents.Sink) error {
		sink.Text(text, false)
		return nil
	}
}

func Delay(delay time.Duration, next Prompt) Prompt {
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

func Append(paths ...string) Prompt {
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

func RecordPrompt(path, reply string) Prompt {
	return func(_ context.Context, _ agents.Open, prompt string, sink agents.Sink) error {
		sink.Text(reply, false)
		return os.WriteFile(path, []byte(prompt), 0600)
	}
}
