package main

import (
	"faah/internal/agents"
	"io"
	"time"
)

const threadSessionIdle = 10 * time.Minute

// Reasoning forwards the agent’s reasoning.
func (s *threadSink) Reasoning(text string) {
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	s.turn.Reasoning += text
	s.tm.publishLocked(s.tid, "reasoning", map[string]any{"turn": s.turn.ID, "text": text})
	s.tm.maybeSaveLocked()
}

type writerSink struct {
	io.Writer
	wrote bool
}

// Text forwards assistant output.
func (s *writerSink) Text(t string, _ bool) { s.wrote = true; _, _ = io.WriteString(s.Writer, t) }

// Reasoning forwards the agent’s reasoning.
func (s *writerSink) Reasoning(string) {}

// Step reports tool activity.
func (s *writerSink) Step(string) {}

// Result supplies an answer when no text was streamed.
func (s *writerSink) Result(t string) {
	if !s.wrote {
		_, _ = io.WriteString(s.Writer, t)
	}
}

type threadSession struct {
	session            agents.Session
	token, name, model string
	mode               agents.Mode
	idle               *time.Timer
}

func (tm *threadManager) closeSessionLocked(id string) {
	if s := tm.sessions[id]; s != nil {
		if s.idle != nil {
			s.idle.Stop()
		}
		s.session.Close()
		tm.tools.tokens.Revoke(s.token)
		delete(tm.sessions, id)
	}
	tm.tools.tokens.RevokeScope(func(scope any) bool { sc, ok := scope.(toolScope); return ok && sc.tid == id })
}

func (tm *threadManager) idleSessionLocked(id string) {
	s := tm.sessions[id]
	if s == nil {
		return
	}
	d := tm.sessionIdle
	if d == 0 {
		d = threadSessionIdle
	}
	s.idle = time.AfterFunc(d, func() {
		tm.mu.Lock()
		defer tm.mu.Unlock()
		if tm.sessions[id] == s && tm.threads[id] != nil && !tm.threads[id].running() {
			tm.closeSessionLocked(id)
		}
	})
}
