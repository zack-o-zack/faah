package threads

import (
	"faah/internal/agents"
	"faah/internal/codeintel"
)

// Runtime supplies the host-owned Explain operations. Threads keep the
// conversation and turn state; the host keeps evidence, MCP and note checks.
type Runtime struct {
	Select       func() (string, []string, string)
	Instructions func(kind, reader string) string
	ToolsPrompt  func() string
	History      func([]codeintel.Note, []codeintel.Walkthrough) string
	ValidateRefs func(root, reply string) map[string]codeintel.Citation
	Issue        func(id string) string
	Touch        func(id string)
	Revoke       func(token string)
	RevokeThread func(id string)
	Endpoint     func(token string) *agents.ToolEndpoint
	HashNotes    func(id string, turn, from int, ns []codeintel.Note)
}

// Snapshot returns independent thread snapshots for host-side note queries.
func (tm *Manager) Snapshot() []*Thread {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	out := make([]*Thread, 0, len(tm.threads))
	for _, t := range tm.threads {
		out = append(out, cloneThread(t))
	}
	return out
}

func (tm *Manager) turnLocked(id string, turn int) *Turn {
	t := tm.threads[id]
	if t == nil {
		return nil
	}
	for _, tr := range t.Turns {
		if tr.ID == turn || (turn == 0 && tr.Running) {
			return tr
		}
	}
	return nil
}

// RunningTurn reports whether a tool scope still names a running turn.
func (tm *Manager) RunningTurn(id string, turn int) bool {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tr := tm.turnLocked(id, turn)
	return tr != nil && tr.Running
}

// AddNotes records checked notes on a running turn.
func (tm *Manager) AddNotes(id string, turn int, ns []codeintel.Note) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(id, turn); tr != nil && tr.Running {
		if tm.runtime.HashNotes != nil {
			tm.runtime.HashNotes(id, turn, len(tr.Notes), ns)
		}
		tr.Notes = append(tr.Notes, ns...)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[id])
	}
}

// AddWalkthrough records a checked walkthrough on a running turn.
func (tm *Manager) AddWalkthrough(id string, turn int, w codeintel.Walkthrough) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(id, turn); tr != nil && tr.Running {
		tr.Walkthroughs = append(tr.Walkthroughs, w)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[id])
	}
}

// SetNoteRefs saves the background callers and references hash of a note.
func (tm *Manager) SetNoteRefs(id string, turn, index int, hash string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(id, turn); tr != nil && index < len(tr.Notes) {
		tr.Notes[index].Refs = hash
		tm.saveLocked()
	}
}
