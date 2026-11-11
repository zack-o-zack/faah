package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testServer() (*Server, string) {
	s := &Server{Name: "faah", Version: "test", Tokens: &Tokens{}}
	s.Tools = []Tool{{
		Name: "echo", Description: "Echoes.", Schema: json.RawMessage(`{"type":"object"}`), ReadOnly: true,
		Call: func(_ context.Context, scope any, args json.RawMessage) (string, error) {
			if scope == nil {
				return "", errors.New("no turn is running")
			}
			if strings.Contains(string(args), "bad") {
				return "", errors.New("bad input")
			}
			return scope.(string) + ":" + string(args), nil
		},
	}}
	return s, s.Tokens.Issue("t1")
}

func post(t *testing.T, s *Server, tok, body string) (int, map[string]any) {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	w := httptest.NewRecorder()
	if !strings.Contains(body, `"method":"initialize"`) && body != "not json" && tok != "" && tok != "wrong" {
		init := httptest.NewRequest("POST", "/api/mcp", strings.NewReader(`{"id":0,"method":"initialize"}`))
		init.Header = r.Header.Clone()
		iw := httptest.NewRecorder()
		s.ServeHTTP(iw, init)
		r.Header.Set("Mcp-Session-Id", iw.Header().Get("Mcp-Session-Id"))
	}
	s.ServeHTTP(w, r)
	var m map[string]any
	b, _ := io.ReadAll(w.Body)
	json.Unmarshal(b, &m)
	return w.Code, m
}

func TestServerHandshakeAndList(t *testing.T) {
	s, tok := testServer()
	code, m := post(t, s, tok, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`)
	res, _ := m["result"].(map[string]any)
	if code != 200 || res["protocolVersion"] != "2025-06-18" || res["serverInfo"].(map[string]any)["name"] != "faah" {
		t.Fatalf("initialize = %d %v", code, m)
	}
	if code, _ := post(t, s, tok, `{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != http.StatusAccepted {
		t.Fatalf("notification = %d", code)
	}
	_, m = post(t, s, tok, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	tools := m["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["name"] != "echo" || tools[0].(map[string]any)["annotations"].(map[string]any)["readOnlyHint"] != true {
		t.Fatalf("tools = %v", tools)
	}
	_, m = post(t, s, tok, `{"jsonrpc":"2.0","id":3,"method":"server/discover"}`)
	if m["error"].(map[string]any)["code"].(float64) != -32601 {
		t.Fatalf("unknown method = %v", m)
	}
}

func TestServerCalls(t *testing.T) {
	s, tok := testServer()
	_, m := post(t, s, tok, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"x":1}}}`)
	res := m["result"].(map[string]any)
	if res["isError"] == true || res["content"].([]any)[0].(map[string]any)["text"] != `t1:{"x":1}` {
		t.Fatalf("call = %v", m)
	}
	_, m = post(t, s, tok, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"x":"bad"}}}`)
	if res := m["result"].(map[string]any); res["isError"] != true || res["content"].([]any)[0].(map[string]any)["text"] != "bad input" {
		t.Fatalf("tool error = %v", m)
	}
	_, m = post(t, s, tok, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope"}}`)
	if m["result"].(map[string]any)["isError"] != true {
		t.Fatalf("unknown tool = %v", m)
	}
	ahead := s.Tokens.Issue(nil)
	_, m = post(t, s, ahead, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo"}}`)
	if m["result"].(map[string]any)["isError"] != true {
		t.Fatalf("unbound call = %v", m)
	}
}

func TestServerRefuses(t *testing.T) {
	s, tok := testServer()
	if code, _ := post(t, s, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`); code != http.StatusUnauthorized {
		t.Fatalf("no token = %d", code)
	}
	if code, _ := post(t, s, "wrong", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`); code != http.StatusUnauthorized {
		t.Fatalf("bad token = %d", code)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/mcp", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET = %d", w.Code)
	}
	if code, m := post(t, s, tok, `not json`); code != 200 || m["error"].(map[string]any)["code"].(float64) != -32700 {
		t.Fatalf("parse error = %d %v", code, m)
	}
}

// A token revoked while its request body is still arriving does not act.
func TestServerRevokedDuringBody(t *testing.T) {
	s, tok := testServer()
	pr, pw := io.Pipe()
	r := httptest.NewRequest(http.MethodPost, "/api/mcp", pr)
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { s.ServeHTTP(w, r); close(done) }()
	pw.Write([]byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call",`))
	s.Tokens.Revoke(tok)
	pw.Write([]byte(`"params":{"name":"echo","arguments":{}}}`))
	pw.Close()
	<-done
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, body %s", w.Code, w.Body)
	}
}
