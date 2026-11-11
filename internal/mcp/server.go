package mcp

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"faah/internal/agents"
)

// Tool is one tool the server offers.
type Tool struct {
	Name        string
	Description string
	Schema      json.RawMessage // JSON Schema of the arguments
	ReadOnly    bool
	Title       string
	Destructive bool
	Idempotent  bool
	OpenWorld   bool
	// Call runs the tool for the scope the caller's token is bound to, nil
	// when it is not bound yet. An error goes back to the agent as a tool
	// error it can act on.
	Call func(ctx context.Context, scope any, args json.RawMessage) (string, error)
}

// Server serves JSON-RPC requests within authenticated transport sessions.
type Server struct {
	Name, Version string
	Tools         []Tool
	Tokens        *Tokens
	mu            sync.Mutex
	sessions      map[string]bool
}

const (
	maxBody         = 1 << 20
	protocolVersion = "2025-06-18"
)

type request struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// ServeHTTP validates MCP credentials and serves the transport protocol.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	reject := func(code int, msg string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		writeJSON(w, response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32600, msg}})
	}
	unauthorized := func() {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("WWW-Authenticate", "Bearer")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		writeJSON(w, map[string]string{"error": "invalid_mcp_credential", "message": "A valid faah MCP credential is required."})
	}
	auth := r.Header.Get("Authorization")
	tok := strings.TrimPrefix(auth, "Bearer ")
	if !strings.HasPrefix(auth, "Bearer ") {
		unauthorized()
		return
	}
	if _, ok := s.Tokens.Resolve(tok); !ok {
		unauthorized()
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Hostname() != "localhost" && (net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback())) {
			reject(403, "invalid origin")
			return
		}
	}
	sid := r.Header.Get("Mcp-Session-Id")
	if r.Method == http.MethodDelete {
		s.mu.Lock()
		ok := s.sessions[sid]
		delete(s.sessions, sid)
		s.mu.Unlock()
		if sid == "" {
			reject(400, "missing session")
		} else if !ok {
			reject(404, "unknown session")
		} else {
			w.WriteHeader(204)
		}
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST, DELETE")
		reject(405, "method not allowed")
		return
	}
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "application/json" {
		reject(415, "application/json required")
		return
	}
	accepts := map[string]bool{}
	for _, part := range strings.Split(r.Header.Get("Accept"), ",") {
		mt, params, _ := mime.ParseMediaType(strings.TrimSpace(part))
		if params["q"] != "0" {
			accepts[mt] = true
		}
	}
	if !accepts["application/json"] || !accepts["text/event-stream"] {
		reject(406, "JSON and event-stream acceptance required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(body) > maxBody {
		reject(413, "request body too large")
		return
	}
	scope, ok := s.Tokens.Resolve(tok)
	if !ok {
		unauthorized()
		return
	}
	body = []byte(strings.TrimSpace(string(body)))
	batch := len(body) > 0 && body[0] == '['
	var reqs []request
	if batch {
		err = json.Unmarshal(body, &reqs)
	} else {
		var one request
		err = json.Unmarshal(body, &one)
		reqs = []request{one}
	}
	if err != nil {
		writeJSON(w, response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{-32700, "parse error"}})
		return
	}

	initializing := false
	for _, q := range reqs {
		if q.Method == "initialize" {
			initializing = true
		}
	}
	if initializing {
		if sid != "" {
			reject(400, "initialize must omit session")
			return
		}
		sid = agents.NewUUID()
		s.mu.Lock()
		if s.sessions == nil {
			s.sessions = map[string]bool{}
		}
		s.sessions[sid] = true
		s.mu.Unlock()
		w.Header().Set("Mcp-Session-Id", sid)
	} else {
		if sid == "" {
			reject(400, "missing session")
			return
		}
		s.mu.Lock()
		known := s.sessions[sid]
		s.mu.Unlock()
		if !known {
			reject(404, "unknown session")
			return
		}
	}
	if v := r.Header.Get("MCP-Protocol-Version"); v != "" && v != protocolVersion {
		reject(400, "unsupported protocol")
		return
	}
	w.Header().Set("MCP-Protocol-Version", protocolVersion)
	var out []response
	for _, q := range reqs {
		if len(q.ID) == 0 || string(q.ID) == "null" || q.Method == "" {
			continue // a notification: nothing to answer
		}
		res, e := s.handle(r.Context(), scope, q)
		out = append(out, response{JSONRPC: "2.0", ID: q.ID, Result: res, Error: e})
	}
	switch {
	case len(out) == 0:
		w.WriteHeader(http.StatusAccepted)
	case batch:
		writeJSON(w, out)
	default:
		writeJSON(w, out[0])
	}
}

func (s *Server) handle(ctx context.Context, scope any, q request) (any, *rpcError) {
	switch q.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(q.Params, &p)
		v := protocolVersion
		return map[string]any{
			"protocolVersion": v,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "faah", "version": s.Version},
		}, nil
	case "notifications/initialized", "ping":
		return map[string]any{}, nil
	case "tools/list":
		list := make([]map[string]any, 0, len(s.Tools))
		for _, t := range s.Tools {
			list = append(list, map[string]any{
				"name": t.Name, "description": t.Description, "inputSchema": t.Schema,
				"annotations": map[string]any{"title": t.Title, "readOnlyHint": t.ReadOnly, "destructiveHint": t.Destructive, "idempotentHint": t.Idempotent, "openWorldHint": t.OpenWorld},
			})
		}
		return map[string]any{"tools": list}, nil
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(q.Params, &p); err != nil {
			return nil, &rpcError{-32602, "invalid params"}
		}
		for _, t := range s.Tools {
			if t.Name == p.Name {
				text, err := t.Call(ctx, scope, p.Arguments)
				if err != nil {
					return toolResult(err.Error(), true), nil
				}
				return toolResult(text, false), nil
			}
		}
		return toolResult("no tool named "+p.Name, true), nil
	}
	return nil, &rpcError{-32601, "method not found: " + q.Method}
}

func toolResult(text string, isError bool) map[string]any {
	return map[string]any{"content": []map[string]any{{"type": "text", "text": text}}, "isError": isError}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
