package threads

import (
	"sort"
	"strings"
	"time"
)

func explainTurnOK(t *Thread) bool {
	if len(t.Turns) == 0 || t.Turns[0].Running {
		return true
	}
	return t.Turns[0].Error == "" && strings.TrimSpace(t.Turns[0].Reply) != ""
}

// Explain opens the explanation matching this evidence, or starts a new one.
// The host supplies the checked evidence and keeps its packet beside the store.
func (tm *Manager) Explain(candidate *Thread, message, packet string, force bool, keep int) (*Thread, bool, error) {
	tm.mu.Lock()
	for _, t := range tm.threads {
		if t.Kind != "explain" || t.ExplainKey != candidate.ExplainKey {
			continue
		}
		if t.Running() || (!force && explainTurnOK(t)) {
			res := cloneThread(t)
			tm.mu.Unlock()
			return res, true, nil
		}
		t.ExplainKey = "" // the conversation stays; it just no longer answers this key
	}
	t := candidate
	t.ID = newThreadID()
	t.Title = threadTitle(t.Title)
	t.Created = time.Now().UnixMilli()
	t.Updated = t.Created
	t.packet = packet
	tm.threads[t.ID] = t
	tm.pruneExplainLocked(keep)
	tm.mu.Unlock()

	tm.writeExplainPacket(t.ID, packet)
	if _, err := tm.Send(t.ID, message); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		tm.removeExplainPacket(t.ID)
		return nil, false, err
	}
	return tm.Get(t.ID), false, nil
}

// pruneExplainLocked drops the oldest explanations nobody followed up on, once
// a workspace has more than it keeps. Callers hold tm.mu.
func (tm *Manager) pruneExplainLocked(keep int) {
	var all []*Thread
	for _, t := range tm.threads {
		if t.Kind == "explain" {
			all = append(all, t)
		}
	}
	if len(all) <= keep {
		return
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Created > all[j].Created })
	for _, t := range all[keep:] {
		if len(t.Turns) > 1 || t.Running() {
			continue
		}
		delete(tm.threads, t.ID)
		tm.removeExplainPacket(t.ID)
		tm.publishLocked("", "deleted", map[string]string{"id": t.ID})
	}
}
