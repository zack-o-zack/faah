package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------- threads

type explainResult struct {
	Thread      *thread
	Cached      bool
	Stale       bool
	StaleReason string
}

func explainTitle(t explainTarget) string {
	if t.Name != "" {
		return "Explain " + t.Name
	}
	return fmt.Sprintf("Explain %s:%s", t.Rel, lineRef(t.L1, t.L2))
}

func explainTurnOK(t *thread) bool {
	if len(t.Turns) == 0 || t.Turns[0].Running {
		return true
	}
	return t.Turns[0].Error == "" && strings.TrimSpace(t.Turns[0].Reply) != ""
}

// explain opens the explanation matching this evidence, or starts a new one.
func (tm *threadManager) explain(target explainTarget, req explainRequest, ev explainEvidence) (*explainResult, error) {
	tm.mu.Lock()
	for _, t := range tm.threads {
		if t.Kind != "explain" || t.ExplainKey != ev.Key {
			continue
		}
		if t.running() || (!req.Force && explainTurnOK(t)) {
			res := &explainResult{Thread: cloneThread(t), Cached: true}
			res.StaleReason = explainStaleReason(t.EvidenceHash, ev.Hash)
			res.Stale = res.StaleReason != ""
			tm.mu.Unlock()
			return res, nil
		}
		t.ExplainKey = "" // the conversation stays; it just no longer answers this key
	}
	summary := ev.Summary
	stored := req
	stored.Force = false
	now := time.Now().UnixMilli()
	title := explainTitle(target)
	t := &thread{
		ID: newThreadID(), Kind: "explain", Title: threadTitle(title),
		Path: target.Rel, L1: target.L1, L2: target.L2, Snippet: target.Text,
		Created: now, Updated: now,
		ExplainKey: ev.Key, ExplainKind: ev.Kind, EvidenceHash: ev.Hash,
		Evidence: &summary, ExplainReq: &stored, packet: ev.Packet,
	}
	tm.threads[t.ID] = t
	tm.pruneExplainLocked()
	tm.mu.Unlock()

	tm.writeExplainPacket(t.ID, ev.Packet)
	if _, err := tm.Send(t.ID, title); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		tm.removeExplainPacket(t.ID)
		return nil, err
	}
	return &explainResult{Thread: tm.Get(t.ID)}, nil
}

// pruneExplainLocked drops the oldest explanations nobody followed up on, once
// a workspace has more than it keeps. Callers hold tm.mu.
func (tm *threadManager) pruneExplainLocked() {
	var all []*thread
	for _, t := range tm.threads {
		if t.Kind == "explain" {
			all = append(all, t)
		}
	}
	if len(all) <= explainKeep {
		return
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Created > all[j].Created })
	for _, t := range all[explainKeep:] {
		if len(t.Turns) > 1 || t.running() {
			continue
		}
		delete(tm.threads, t.ID)
		tm.removeExplainPacket(t.ID)
		tm.publishLocked("", "deleted", map[string]string{"id": t.ID})
	}
}

// Packets live beside the store, because saveLocked rewrites the whole store
// on every turn and they are up to 16 KB each.
func (tm *threadManager) explainPacketPath(id string) string {
	if tm.file == "" {
		return ""
	}
	return filepath.Join(strings.TrimSuffix(tm.file, ".json")+".explain", id+".md")
}

func (tm *threadManager) writeExplainPacket(id, packet string) {
	p := tm.explainPacketPath(id)
	if p == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(p, []byte(packet), 0o600)
}

func (tm *threadManager) readExplainPacket(id string) string {
	p := tm.explainPacketPath(id)
	if p == "" {
		return ""
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	return string(data)
}

func (tm *threadManager) removeExplainPacket(id string) {
	if p := tm.explainPacketPath(id); p != "" {
		_ = os.Remove(p)
	}
}
