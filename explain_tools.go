package main

import (
	"net"
	"net/http"
	"sync/atomic"

	"faah/internal/agents"
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
