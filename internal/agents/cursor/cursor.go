// Package cursor runs persistent Cursor SDK conversations through a Node helper.
package cursor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/host"
)

// Agent opens local SDK conversations.
type Agent struct{}

// New returns the Cursor adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return "cursor-agent" }

// Open installs the SDK helper and creates or resumes a conversation.
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	dir, err := prepare(ctx)
	if err != nil {
		return nil, err
	}
	return openHelper(ctx, o, []string{"node", "helper.mjs"}, dir)
}

func options(o agents.Open, opening bool) map[string]any {
	v := map[string]any{"mode": "agent"}
	if opening && o.Mode == agents.ModeAsk {
		v["tools"] = []string{"read", "grep", "glob", "ls", "mcp"}
	}
	if o.Model != "" {
		v["model"] = map[string]string{"id": o.Model}
	}
	if o.Tools != nil {
		v["mcpServers"] = map[string]any{"faah": map[string]any{"type": "http", "url": o.Tools.URL, "headers": map[string]string{"Authorization": o.Tools.Authorization}}}
	}
	if opening {
		v["name"] = "faah"
		sources := []string{"project", "user", "team", "mdm", "plugins"}
		if o.Mode == agents.ModeAsk {
			sources = []string{}
		}
		v["local"] = map[string]any{"cwd": o.Dir, "settingSources": sources, "sandboxOptions": map[string]bool{"enabled": true}}
	}
	return v
}

type frame struct {
	Op      string `json:"op"`
	AgentID string `json:"agentId"`
	Message string `json:"message"`
	Status  string `json:"status"`
	Error   string `json:"error"`
	Result  string `json:"result"`
	Update  struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		CallID   string `json:"callId"`
		ToolCall struct {
			Type string          `json:"type"`
			Args json.RawMessage `json:"args"`
		} `json:"toolCall"`
	} `json:"update"`
}

type session struct {
	o      agents.Open
	id     string
	p      *host.Process
	turn   sync.Mutex
	mu     sync.Mutex
	active chan struct{}
	closed bool
}

func openHelper(ctx context.Context, o agents.Open, argv []string, dir string) (agents.Session, error) {
	var err error
	o.Dir, err = filepath.Abs(o.Dir)
	if err != nil {
		return nil, err
	}
	p, err := host.Start(argv, dir, append(os.Environ(), o.Env...), o.Stderr)
	if err != nil {
		return nil, err
	}
	s := &session{o: o, p: p}
	if err = s.write(map[string]any{"op": "open", "agentId": o.Resume, "options": options(o, true)}); err != nil {
		p.Close()
		return nil, err
	}
	f, err := s.read(ctx)
	if err == nil && (f.Op != "opened" || f.AgentID == "" || (o.Resume != "" && f.AgentID != o.Resume)) {
		err = errors.New("cursor open failed: " + f.Message)
	}
	if err != nil {
		p.Close()
		return nil, err
	}
	s.id = f.AgentID
	return s, nil
}

func (s *session) write(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.p.Write(append(b, '\n'))
	return err
}

func (s *session) read(ctx context.Context) (frame, error) {
	select {
	case b, ok := <-s.p.Lines:
		if !ok {
			<-s.p.Exited
			return frame{}, s.p.Error()
		}
		var f frame
		err := json.Unmarshal(b, &f)
		return f, err
	case <-ctx.Done():
		return frame{}, ctx.Err()
	}
}

// ID returns the native agent identifier.
func (s *session) ID() string { return s.id }

// Prompt streams one turn until the SDK reports its final status.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	out := agents.Outcome{SessionID: s.id, Live: true}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return out, errors.New("cursor session is closed")
	}
	done := make(chan struct{})
	s.active = done
	err := s.write(map[string]any{"op": "send", "text": text, "options": options(s.o, false)})
	s.mu.Unlock()
	defer func() { s.mu.Lock(); close(done); s.active = nil; s.mu.Unlock() }()
	if err != nil {
		return out, err
	}
	seen := map[string]bool{}
	hadText, boundary := false, false
	var interrupted error
	readCtx := ctx
	for {
		f, err := s.read(readCtx)
		if err != nil {
			if ctx.Err() != nil && interrupted == nil {
				interrupted = ctx.Err()
				if err = s.write(map[string]string{"op": "cancel"}); err == nil {
					drainCtx, stop := context.WithTimeout(context.Background(), 15*time.Second)
					defer stop()
					readCtx = drainCtx
					continue
				}
			}
			s.p.Close()
			out.Live = false
			if interrupted != nil {
				return out, interrupted
			}
			return out, err
		}
		switch f.Op {
		case "delta":
			u := f.Update
			switch u.Type {
			case "text-delta":
				sink.Text(u.Text, hadText && boundary)
				hadText = true
				boundary = false
			case "thinking-delta":
				sink.Reasoning(u.Text)
			case "step-started", "step-completed", "turn-ended", "tool-call-completed":
				boundary = hadText
			case "tool-call-started":
				boundary = hadText
				if !seen[u.CallID] {
					seen[u.CallID] = true
					sink.Step(agents.ToolLabel(u.ToolCall.Type, u.ToolCall.Args))
				}
			}
		case "done":
			if interrupted != nil {
				return out, interrupted
			}
			if f.Status == "error" || f.Status == "failed" {
				if f.Error == "" {
					f.Error = "cursor turn failed"
				}
				return out, errors.New(f.Error)
			}
			if f.Status != "finished" && f.Status != "cancelled" {
				return out, fmt.Errorf("cursor returned unknown status %q", f.Status)
			}
			if !hadText && f.Result != "" {
				sink.Result(f.Result)
			}
			return out, nil
		case "error":
			return out, errors.New(f.Message)
		}
	}
}

// Interrupt cancels the active run and waits up to fifteen seconds for completion.
func (s *session) Interrupt(ctx context.Context) error {
	s.mu.Lock()
	done := s.active
	var err error
	if done != nil {
		err = s.write(map[string]string{"op": "cancel"})
	}
	s.mu.Unlock()
	if done == nil {
		return nil
	}
	if err != nil {
		s.p.Close()
		return err
	}
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		s.p.Close()
		return ctx.Err()
	case <-timer.C:
		s.p.Close()
		return errors.New("cursor cancel timed out")
	}
}

// Close releases the SDK conversation and helper process.
func (s *session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()
	_ = s.write(map[string]string{"op": "close"})
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case <-s.p.Exited:
	case <-timer.C:
		s.p.Close()
	}
	return nil
}
