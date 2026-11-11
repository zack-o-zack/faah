package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Tool is one tool the server offers.
type Tool struct {
	Name        string
	Description string
	Schema      json.RawMessage // JSON Schema of the arguments
	ReadOnly    bool
	// Call runs the tool for the scope the caller's token is bound to, nil
	// when it is not bound yet. An error goes back to the agent as a tool
	// error it can act on.
	Call func(ctx context.Context, scope any, args json.RawMessage) (string, error)
}

// Server answers MCP requests POSTed as JSON-RPC, one message or a batch.
// It has no streams and no sessions: every answer is a JSON body.
type Server struct {
	Name, Version string
	Tools         []Tool
	Tokens        *Tokens
}

const (
	maxBody         = 1 << 20
	protocolVersion = "2025-06-18"
)

var protocols = map[string]bool{"2024-11-05": true, "2025-03-26": true, "2025-06-18": true}

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

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if _, ok := s.Tokens.Lookup(tok); !ok {
		http.Error(w, "unknown token", http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Look again: the token may have been revoked while the body arrived.
	scope, ok := s.Tokens.Lookup(tok)
	if !ok {
		http.Error(w, "unknown token", http.StatusUnauthorized)
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
	var out []response
	for _, q := range reqs {
		if len(q.ID) == 0 || string(q.ID) == "null" {
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
		if protocols[p.ProtocolVersion] {
			v = p.ProtocolVersion
		}
		return map[string]any{
			"protocolVersion": v,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": s.Name, "version": s.Version},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		list := make([]map[string]any, 0, len(s.Tools))
		for _, t := range s.Tools {
			list = append(list, map[string]any{
				"name": t.Name, "description": t.Description, "inputSchema": t.Schema,
				"annotations": map[string]any{"readOnlyHint": t.ReadOnly},
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
