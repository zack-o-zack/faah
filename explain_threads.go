package main

import (
	"fmt"

	"faah/internal/explain"
	"faah/internal/threads"
)

// ---------------------------------------------------------------- threads

type explainResult struct {
	Thread      *threads.Thread
	Cached      bool
	Stale       bool
	StaleReason string
}

func explainTitle(t explain.Target) string {
	if t.Name != "" {
		return "Explain " + t.Name
	}
	return fmt.Sprintf("Explain %s:%s", t.Rel, lineRef(t.L1, t.L2))
}

// explain opens the explanation matching this evidence, or starts a new one.
func (tm *threadManager) explain(target explain.Target, req explain.Request, ev explain.Evidence) (*explainResult, error) {
	reader := explainReader()
	summary := ev.Summary
	stored := req
	stored.Force = false
	title := explainTitle(target)
	candidate := &threads.Thread{
		Kind: "explain", Title: title,
		Path: target.Rel, L1: target.L1, L2: target.L2, Snippet: target.Text,
		ExplainKey: ev.Key, ExplainKind: ev.Kind, ExplainReader: reader, EvidenceHash: ev.Hash,
		Evidence: &summary, ExplainReq: &stored,
	}
	th, cached, err := tm.Manager.Explain(candidate, title, ev.Packet, req.Force, explainKeep)
	if err != nil {
		return nil, err
	}
	res := &explainResult{Thread: th, Cached: cached}
	if cached {
		res.StaleReason = explain.StaleReason(th.EvidenceHash, ev.Hash)
		if th.ExplainReader != reader {
			res.StaleReason = "reader"
		}
		res.Stale = res.StaleReason != ""
	}
	return res, nil
}
