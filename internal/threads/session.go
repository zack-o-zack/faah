package threads

import (
	"time"

	"faah/internal/agents"
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

type threadSession struct {
	session            agents.Session
	token, name, model string
	mode               agents.Mode
	idle               *time.Timer
}

func (tm *Manager) closeSessionLocked(id string) {
	if s := tm.sessions[id]; s != nil {
		if s.idle != nil {
			s.idle.Stop()
		}
		s.session.Close()
		tm.runtime.Revoke(s.token)
		delete(tm.sessions, id)
	}
	tm.runtime.RevokeThread(id)
}

func (tm *Manager) idleSessionLocked(id string) {
	s := tm.sessions[id]
	if s == nil {
		return
	}
	d := tm.sessionIdle
	if d == 0 {
		d = threadSessionIdle
	}
	var timer *time.Timer
	timer = time.AfterFunc(d, func() {
		tm.mu.Lock()
		defer tm.mu.Unlock()
		if tm.sessions[id] == s && s.idle == timer && tm.threads[id] != nil && !tm.threads[id].Running() {
			tm.closeSessionLocked(id)
		}
	})
	s.idle = timer
}
