package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"faah/internal/agents"
	"faah/internal/explain"
	"faah/internal/symbols"
	"faah/internal/ui"
)

// Explain This. A reader selects code and gets a short explanation grounded in
// what the IDE knows. faah gathers the evidence itself, because a harness is a
// separate process with no way to reach the language server, and hands it over
// inside the prompt. The harness runs read-only and only writes the words. The
// logic is in internal/explain; this file serves it over HTTP.

const (
	explainKeep       = 200             // explanations kept before the oldest are pruned
	explainServerWait = 5 * time.Second // how long evidence waits for a language server to start
)

var errHarnessNotReadOnly = agents.ErrNotReadOnly

// ---------------------------------------------------------------- HTTP

// explainWorkspace is the Server as Explain sees it. Code intelligence comes
// straight from the language-server manager.
type explainWorkspace struct {
	*lspManager
	s *Server
}

func (w explainWorkspace) Ready(ctx context.Context, abs, rel string) string {
	w.s.lsp.RefreshOpenDocs() // files may have changed outside faah since last asked
	_ = w.s.lsp.EnsureOpen(ctx, abs, rel)
	// A server still starting is worth a short wait: its answers are
	// far better evidence than a text search.
	deadline := time.Now().Add(explainServerWait)
	for {
		state, server := w.s.lsp.State(rel)
		if state == lspReady {
			return server
		}
		if (state != lspStarting && state != lspIndexing) || time.Now().After(deadline) {
			return ""
		}
		select {
		case <-ctx.Done():
			return ""
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func (explainWorkspace) Outline(abs, rel string) ([]symbols.Symbol, error) {
	return symbols.Outline(abs, rel)
}

func (w explainWorkspace) Search(ctx context.Context, name string) []FileMatches {
	res, _, err := SearchContext(ctx, w.s.ix, SearchOpts{Query: name, Word: true, Case: true, MaxFiles: 50, MaxPerFil: 20, classifyDefs: true})
	if err != nil {
		return nil
	}
	return res
}

func (w explainWorkspace) Abs(rel string) (string, bool) {
	abs, _, ok := w.s.safePath(rel)
	return abs, ok
}

// explain.Target checks a request against the file on disk. The status is the
// HTTP code to answer with when it fails.
func (s *Server) explainTarget(req *explain.Request) (explain.Target, []string, string, int, error) {
	abs, rel, ok := s.safePath(req.Path)
	if !ok || rel == "" {
		return explain.Target{}, nil, "", 400, errors.New("bad path")
	}
	lines, err := explain.ReadLines(abs)
	if err != nil {
		return explain.Target{}, nil, "", 400, errors.New("cannot read " + rel)
	}
	target, err := explain.Classify(lines, *req)
	if err != nil {
		code := 400
		if errors.Is(err, explain.ErrMismatch) {
			code = 409
		}
		return explain.Target{}, nil, "", code, err
	}
	target.Abs, target.Rel = abs, rel
	req.Path = rel
	return target, lines, explainPrepareKey(abs, *req), 0, nil
}

// handleExplain serves POST /api/explain: classify, gather, then reopen or start.
func (s *Server) handleExplain(w http.ResponseWriter, r *http.Request) {
	if !localPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var req explain.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, 400, "bad request")
		return
	}
	target, lines, key, code, err := s.explainTarget(&req)
	if err != nil {
		fail(w, code, err.Error())
		return
	}

	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), explain.Budget)
	defer cancel()
	ev, prepared := s.preparedExplain(ctx, key)
	if !prepared {
		ev = s.gatherExplainEvidence(ctx, target, lines)
	}
	if r.Context().Err() != nil {
		return // the reader has moved on
	}
	if ui.Verbose {
		ui.Status("info", "explain", fmt.Sprintf("%s:%s evidence in %s (prepared=%v)", target.Rel, lineRef(target.L1, target.L2), ui.FmtDuration(time.Since(started)), prepared), 0, os.Stdout)
	}

	res, err := s.threads.explain(target, req, ev)
	if err != nil {
		fail(w, threadStatus(err), err.Error())
		return
	}
	writeJSON(w, map[string]any{
		"thread": res.Thread, "cached": res.Cached,
		"stale": res.Stale, "staleReason": res.StaleReason,
	})
}
