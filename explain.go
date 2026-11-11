package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"faah/internal/agents"
	"faah/internal/symbols"
	"faah/internal/ui"
)

// Explain This. A reader selects code and gets a short explanation grounded in
// what the IDE knows. faah gathers the evidence itself, because a harness is a
// separate process with no way to reach the language server, and hands it over
// inside the prompt. The harness runs read-only and only writes the words.

const (
	explainPromptVersion = 1
	explainMaxLines      = 400
	explainMaxFileBytes  = 8 << 20
	explainPacketMax     = 16 << 10
	explainTargetMax     = 10 << 10
	explainBodyMax       = 6 << 10
	explainDocMax        = 2 << 10
	explainMaxIdents     = 15
	explainMaxIdentTries = 40
	explainMaxCalls      = 12
	explainMaxRefs       = 40
	explainMaxRefsFile   = 8
	explainFallbackLines = 80
	explainSnapLines     = 20
	explainKeep          = 200
	explainBudget        = 8 * time.Second
	explainServerWait    = 5 * time.Second
)

// What a symbol turned out to be, and "block" for everything else.
const (
	explainWorkspace = "symbol"
	explainLocal     = "local"
	explainExternal  = "external"
	explainBlock     = "block"
)

var (
	errExplainBlank       = errors.New("nothing is selected")
	errExplainTooLong     = fmt.Errorf("select %d lines or fewer", explainMaxLines)
	errExplainMismatch    = errors.New("save the file to explain the current code")
	errHarnessNotReadOnly = agents.ErrNotReadOnly

	explainIdentRe = regexp.MustCompile(`[\p{L}_$][\p{L}\p{N}_$]*`)
	explainWholeID = regexp.MustCompile(`^[\p{L}_$][\p{L}\p{N}_$]*$`)
	explainTagRe   = regexp.MustCompile(`<[^>]+>`)

	// These three mirror what thrInline turns into links in the client.
	explainMdLinkRe = regexp.MustCompile(`\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)`)
	explainBareRe   = regexp.MustCompile(`(?m)(?:^|[\s(])([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?)`)
	explainTargetRe = regexp.MustCompile(`^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$`)
)

// Words that are never worth asking a language server about in a block.
var explainKeywords = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(`if else for while do switch case default break continue return func function
		fn def var let const type struct class interface enum import from package new delete try catch finally
		throw defer go range map chan select nil null none true false this self async await static public
		private protected void int string bool float double long char in is not and or`) {
		m[w] = true
	}
	return m
}()

// explainRequest is what the client sends. A diff selection has no columns.
type explainRequest struct {
	Path  string `json:"path"`
	L1    int    `json:"l1"`
	C1    *int   `json:"c1,omitempty"`
	L2    int    `json:"l2"`
	C2    *int   `json:"c2,omitempty"`
	Text  string `json:"text"`
	Force bool   `json:"force,omitempty"`
}

// explainTarget is a selection checked against the file on disk. Name and Col
// are set for a symbol; Col is -1 for a block.
type explainTarget struct {
	Abs, Rel string
	L1, L2   int
	Col      int
	Name     string
	Text     string
}

// explainSummary is the line of evidence shown under an explanation.
type explainSummary struct {
	Source      string `json:"source"` // language server name, or "text"
	Definition  bool   `json:"definition,omitempty"`
	Refs        int    `json:"refs,omitempty"`
	RefFiles    int    `json:"refFiles,omitempty"`
	Callers     int    `json:"callers,omitempty"`
	Identifiers int    `json:"identifiers,omitempty"`
}

// validatedRef is a citation that survived checking; End is set for a range.
type validatedRef struct {
	Line int `json:"line,omitempty"`
	End  int `json:"end,omitempty"`
}

// utf16Len counts a string in the units JavaScript columns use.
// ---------------------------------------------------------------- HTTP

func (s *Server) explainDeps() explainDeps {
	return explainDeps{
		intel: s.lsp,
		ready: func(ctx context.Context, abs, rel string) string {
			s.lsp.RefreshOpenDocs() // files may have changed outside faah since last asked
			_ = s.lsp.EnsureOpen(ctx, abs, rel)
			// A server still starting is worth a short wait: its answers are
			// far better evidence than a text search.
			deadline := time.Now().Add(explainServerWait)
			for {
				state, server := s.lsp.State(rel)
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
		},
		outline: symbols.Outline,
		search: func(ctx context.Context, name string) []FileMatches {
			res, _, err := SearchContext(ctx, s.ix, SearchOpts{Query: name, Word: true, Case: true, MaxFiles: 50, MaxPerFil: 20, classifyDefs: true})
			if err != nil {
				return nil
			}
			return res
		},
		abs: func(rel string) (string, bool) {
			abs, _, ok := s.safePath(rel)
			return abs, ok
		},
	}
}

// explainTarget checks a request against the file on disk. The status is the
// HTTP code to answer with when it fails.
func (s *Server) explainTarget(req *explainRequest) (explainTarget, []string, string, int, error) {
	abs, rel, ok := s.safePath(req.Path)
	if !ok || rel == "" {
		return explainTarget{}, nil, "", 400, errors.New("bad path")
	}
	lines, err := explainReadLines(abs)
	if err != nil {
		return explainTarget{}, nil, "", 400, errors.New("cannot read " + rel)
	}
	target, err := classifyExplain(lines, *req)
	if err != nil {
		code := 400
		if errors.Is(err, errExplainMismatch) {
			code = 409
		}
		return explainTarget{}, nil, "", code, err
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
	var req explainRequest
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
	ctx, cancel := context.WithTimeout(r.Context(), explainBudget)
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
