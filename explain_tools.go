package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"sort"
	"sync"
	"sync/atomic"
	"time"

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
	refs   refsCache
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
	return &agents.ToolEndpoint{URL: *u, Authorization: "Bearer " + tok}
}

// AddNotes records notes on the turn the scope names, while it runs.
func (tm *threadManager) AddNotes(scope any, ns []notes.Note) {
	sc, _ := scope.(toolScope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil && tr.Running {
		tm.saveNotesLocked(sc, tr, ns)
	}
}

func (tm *threadManager) saveNotesLocked(sc toolScope, tr *threadTurn, ns []notes.Note) {
	tm.hashNotes(sc, len(tr.Notes), ns)
	tr.Notes = append(tr.Notes, ns...)
	tm.saveLocked()
	tm.publishThreadLocked(tm.threads[sc.tid])
}

// AddWalkthrough records a walkthrough on the turn the scope names, while it
// runs.
func (tm *threadManager) AddWalkthrough(scope any, w notes.Walkthrough) {
	sc, _ := scope.(toolScope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil && tr.Running {
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
	type saved struct {
		v    notes.View
		when int64
	}
	var all []saved
	tm.mu.Lock()
	for _, t := range tm.threads {
		if t.Kind != "explain" {
			continue
		}
		for _, tr := range t.Turns {
			for i, n := range tr.Notes {
				if n.Path == rel {
					all = append(all, saved{notes.View{Thread: t.ID, Turn: tr.ID, Index: i, Note: n}, tr.Started})
				}
			}
		}
	}
	tm.mu.Unlock()

	// Newest turn first, and within a turn the later note first.
	sort.SliceStable(all, func(a, b int) bool {
		if all[a].when != all[b].when {
			return all[a].when > all[b].when
		}
		return all[a].v.Index > all[b].v.Index
	})
	seen := map[string]bool{}
	out := make([]notes.View, 0, len(all))
	for _, sv := range all {
		v := sv.v
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
		if v.Kind == "symbol" && v.Stale == "" && v.Refs != "" {
			if cur := tm.tools.refs.get(v, tm.symbolHash); cur != "" && explain.StaleReason(v.Refs, cur) != "" {
				v.Stale = "refs"
			}
		}
		out = append(out, v)
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].L1 < out[b].L1 })
	return out
}

// hashNotes saves, in the background, the callers and references of each
// symbol note in ns, which were added to the turn at index from, so that
// FileNotes can tell when they change.
func (tm *threadManager) hashNotes(sc toolScope, from int, ns []notes.Note) {
	if tm.symbolHash == nil {
		return
	}
	go func() {
		for i, n := range ns {
			if n.Kind != "symbol" {
				continue
			}
			h := tm.symbolHash(n.Path, n.L1, n.Symbol)
			tm.mu.Lock()
			if tr := tm.turnLocked(sc); tr != nil && from+i < len(tr.Notes) {
				tr.Notes[from+i].Refs = h
				tm.saveLocked()
			}
			tm.mu.Unlock()
		}
	}()
}

// refsCache holds each symbol note's current callers and references hash,
// computed in the background and refreshed after refsFresh.
type refsCache struct {
	mu sync.Mutex
	m  map[string]refsEntry
}

type refsEntry struct {
	hash    string
	at      time.Time
	running bool
}

var refsFresh = 10 * time.Second // a var for tests

// get returns the last hash computed for v, "" before the first, and starts
// a new computation when that one is old.
func (c *refsCache) get(v notes.View, hash func(rel string, line int, name string) string) string {
	if hash == nil {
		return ""
	}
	key := fmt.Sprintf("%s\x00%d\x00%d", v.Thread, v.Turn, v.Index)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[string]refsEntry{}
	}
	e := c.m[key]
	if !e.running && time.Since(e.at) > refsFresh {
		e.running = true
		c.m[key] = e
		go func() {
			h := hash(v.Path, v.L1, v.Symbol)
			c.mu.Lock()
			c.m[key] = refsEntry{hash: h, at: time.Now()}
			c.mu.Unlock()
		}()
	}
	return e.hash
}

// symbolHash gathers the callers and references of name on rel:line, as an
// explanation of it would, and returns their hash.
func (s *Server) symbolHash(rel string, line int, name string) string {
	abs, rel, ok := s.safePath(rel)
	if !ok {
		return ""
	}
	lines, err := explain.ReadLines(abs)
	if err != nil || line < 1 || line > len(lines) {
		return ""
	}
	at := wholeWord(lines[line-1], name)
	if at < 0 {
		return ""
	}
	c1 := explain.UTF16Len(lines[line-1][:at])
	c2 := c1 + explain.UTF16Len(name)
	req := explain.Request{Path: rel, L1: line, L2: line, C1: &c1, C2: &c2, Text: name}
	target, err := explain.Classify(lines, req)
	if err != nil {
		return ""
	}
	target.Abs, target.Rel = abs, rel
	ctx, cancel := context.WithTimeout(context.Background(), explain.Budget)
	defer cancel()
	return explain.Gather(ctx, explainWorkspace{s.lsp, s}, target, lines).Hash
}

// wholeWord is the byte offset of name as a whole word in line, or -1.
func wholeWord(line, name string) int {
	re := regexp.MustCompile(`(?:^|[^\p{L}\p{N}_$])(` + regexp.QuoteMeta(name) + `)(?:$|[^\p{L}\p{N}_$])`)
	if m := re.FindStringSubmatchIndex(line); m != nil {
		return m[2]
	}
	return -1
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
