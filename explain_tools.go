package main

import (
	"fmt"
	"net"
	"net/http"
	"sort"
	"sync/atomic"

	"faah/internal/agents"
	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/mcp"
)

// toolScope is the turn a token acts for.
type toolScope struct {
	tid  string
	turn int
}

// explainTools serves annotate and walkthrough to explain turns over MCP. A
// turn gets a token of its own, revoked when the turn ends.
type explainTools struct {
	tokens mcp.Tokens
	srv    *mcp.Server
	addr   atomic.Pointer[string] // the MCP endpoint harnesses reach; nil until faah listens
}

func newExplainTools(tm *threadManager) *explainTools {
	et := &explainTools{}
	et.srv = &mcp.Server{Name: "faah", Version: version, Tokens: &et.tokens, Tools: notes.Tools(notes.DiskReader(tm.root), tm)}
	return et
}

// endpoint is where a turn reaches the tools with tok, or nil before faah listens.
func (et *explainTools) endpoint(tok string) *agents.ToolEndpoint {
	u := et.addr.Load()
	if u == nil {
		return nil
	}
	return &agents.ToolEndpoint{URL: *u, Token: tok}
}

// AddNotes records notes on the turn the scope names.
func (tm *threadManager) AddNotes(scope any, ns []notes.Note) {
	sc, _ := scope.(toolScope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil {
		tr.Notes = append(tr.Notes, ns...)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[sc.tid])
	}
}

// AddWalkthrough records a walkthrough on the turn the scope names.
func (tm *threadManager) AddWalkthrough(scope any, w notes.Walkthrough) {
	sc, _ := scope.(toolScope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil {
		tr.Walkthroughs = append(tr.Walkthroughs, w)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[sc.tid])
	}
}

func (tm *threadManager) turnLocked(sc toolScope) *threadTurn {
	t := tm.threads[sc.tid]
	if t == nil {
		return nil
	}
	for _, tr := range t.Turns {
		if tr.ID == sc.turn {
			return tr
		}
	}
	return nil
}

// SetToolsAddr tells explain turns where faah listens, as host:port. A
// server listening on every interface is reached on loopback.
func (s *Server) SetToolsAddr(addr string) {
	if s.threads == nil {
		return
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	u := "http://" + net.JoinHostPort(host, port) + s.routePath("/api/mcp")
	s.threads.tools.addr.Store(&u)
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	s.threads.tools.srv.ServeHTTP(w, r)
}

// FileNotes is every saved note on rel, found again in lines, the file as it
// is now. A note whose code is gone stays where it was, marked "text". Where
// notes cover the same code, the newest wins.
func (tm *threadManager) FileNotes(rel string, lines []string) []notes.View {
	tm.mu.Lock()
	var views []notes.View
	var when []int64
	for _, t := range tm.threads {
		if t.Kind != "explain" {
			continue
		}
		for _, tr := range t.Turns {
			for _, n := range tr.Notes {
				if n.Path == rel {
					views = append(views, notes.View{Thread: t.ID, Turn: tr.ID, Note: n})
					when = append(when, tr.Started)
				}
			}
		}
	}
	tm.mu.Unlock()

	// Newest turn first, and within a turn the later note first.
	idx := make([]int, len(views))
	for i := range idx {
		idx[i] = len(views) - 1 - i
	}
	sort.SliceStable(idx, func(a, b int) bool { return when[idx[a]] > when[idx[b]] })
	seen := map[string]bool{}
	out := make([]notes.View, 0, len(views))
	for _, i := range idx {
		v := views[i]
		if l1, l2, ok := notes.Locate(lines, v.Text, v.L1); ok {
			v.L1, v.L2 = l1, l2
		} else {
			v.Stale = "text"
			v.L1, v.L2 = min(v.L1, len(lines)), min(v.L2, len(lines))
		}
		key := fmt.Sprintf("%s %d %d", v.Kind, v.L1, v.L2)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, v)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].L1 < out[b].L1 })
	return out
}

func (s *Server) handleExplainNotes(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	_, rel, ok := s.safePath(r.URL.Query().Get("path"))
	abs, inside := explain.Resolve(s.ix.Root(), rel)
	if !ok || !inside || rel == "" {
		fail(w, http.StatusBadRequest, "bad path")
		return
	}
	lines, err := explain.ReadLines(abs)
	if err != nil {
		fail(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, map[string]any{"notes": s.threads.FileNotes(rel, lines)})
}
