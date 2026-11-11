package mcp

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMCPTransportLifecycle(t *testing.T) {
	s, tok := testServer()
	call := func(method, body, sid, ct, accept string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api/mcp", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+tok)
		r.Header.Set("Content-Type", ct)
		r.Header.Set("Accept", accept)
		if sid != "" {
			r.Header.Set("Mcp-Session-Id", sid)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	const both = "application/json, text/event-stream"
	for _, tc := range []struct {
		method, body, sid, ct, accept string
		code                          int
	}{
		{"GET", "", "", "", "", 405}, {"PUT", "", "", "", "", 405}, {"PATCH", "", "", "", "", 405}, {"OPTIONS", "", "", "", "", 405},
		{"POST", `{"id":1,"method":"initialize"}`, "", "text/plain", both, 415},
		{"POST", `{"id":1,"method":"initialize"}`, "", "application/json", "application/json", 406},
		{"POST", `{"id":1,"method":"ping"}`, "", "application/json", both, 400},
		{"POST", `{"id":1,"method":"ping"}`, "unknown", "application/json", both, 404},
	} {
		if w := call(tc.method, tc.body, tc.sid, tc.ct, tc.accept); w.Code != tc.code {
			t.Fatalf("%+v: %d %s", tc, w.Code, w.Body)
		}
	}
	w := call("POST", `{"id":1,"method":"initialize"}`, "", "application/json", both)
	sid := w.Header().Get("Mcp-Session-Id")
	if w.Code != 200 || len(sid) != 36 || w.Header().Get("MCP-Protocol-Version") != "2025-06-18" {
		t.Fatalf("initialize: %v %s", w.Header(), w.Body)
	}
	for _, body := range []string{`{"method":"notifications/initialized"}`, `{"id":1,"result":{}}`, `[{"method":"notifications/initialized"},{"id":1,"result":{}}]`} {
		w = call("POST", body, sid, "application/json", both)
		if w.Code != 202 || w.Body.Len() != 0 {
			t.Fatalf("notification: %d %s", w.Code, w.Body)
		}
	}
	if w = call("POST", `{"id":2,"method":"initialize"}`, sid, "application/json", both); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w = call("DELETE", "", sid, "", ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w = call("POST", `{"id":2,"method":"ping"}`, sid, "application/json", both); w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestMCPCredentialResponse(t *testing.T) {
	s, _ := testServer()
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/api/mcp", nil))
	if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("WWW-Authenticate") != "Bearer" || strings.TrimSpace(w.Body.String()) != `{"error":"invalid_mcp_credential","message":"A valid faah MCP credential is required."}` {
		t.Fatalf("%d %v %s", w.Code, w.Header(), w.Body)
	}
}
func TestMCPTokenExpiryAndHashes(t *testing.T) {
	now := time.Unix(100, 0)
	ts := Tokens{now: func() time.Time { return now }}
	tok := ts.Issue("thread")
	raw, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil || len(raw) != 32 {
		t.Fatal(tok)
	}
	if _, ok := ts.m[sha256.Sum256([]byte(tok))]; !ok {
		t.Fatal("hash not stored")
	}
	now = now.Add(23 * time.Hour)
	if _, ok := ts.Resolve(tok); !ok {
		t.Fatal("expired early")
	}
	now = now.Add(23 * time.Hour)
	ts.Touch("thread")
	now = now.Add(23 * time.Hour)
	if _, ok := ts.Resolve(tok); !ok {
		t.Fatal("touch did not refresh")
	}
	now = now.Add(24 * time.Hour)
	if _, ok := ts.Resolve(tok); ok {
		t.Fatal("expired token resolved")
	}
	ts.Touch("thread")
	if _, ok := ts.Resolve(tok); !ok {
		t.Fatal("trusted touch did not revive")
	}
	ts.RevokeScope(func(v any) bool { return v == "thread" })
	if _, ok := ts.Resolve(tok); ok {
		t.Fatal("scope not revoked")
	}
}

func transportCall(s *Server, tok, sid, method string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/api/mcp", strings.NewReader(`{"id":1,"method":"`+method+`"}`))
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	r.Header.Set("Mcp-Session-Id", sid)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestMCPRevokeRemovesTransports(t *testing.T) {
	for _, scope := range []bool{false, true} {
		t.Run(map[bool]string{false: "token", true: "scope"}[scope], func(t *testing.T) {
			s, tok := testServer()
			for index := 0; index < 2; index++ {
				if w := transportCall(s, tok, "", "initialize"); w.Code != 200 {
					t.Fatal(w.Code)
				}
			}
			other := s.Tokens.Issue("t2")
			w := transportCall(s, other, "", "initialize")
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			if scope {
				s.Tokens.RevokeScope(func(value any) bool { return value == "t1" })
			} else {
				s.Tokens.Revoke(tok)
			}
			s.mu.Lock()
			count := len(s.sessions)
			s.mu.Unlock()
			if count != 1 {
				t.Fatalf("revoked transports remain: %d sessions", count)
			}
			if got := transportCall(s, other, w.Header().Get("Mcp-Session-Id"), "ping"); got.Code != 200 {
				t.Fatalf("unrelated transport was removed: %d", got.Code)
			}
		})
	}
}

func TestMCPExpiredTransportsAreDropped(t *testing.T) {
	for _, trigger := range []string{"initialize", "request", "touch"} {
		t.Run(trigger, func(t *testing.T) {
			now := time.Unix(100, 0)
			s, tok := testServer()
			s.Tokens.now = func() time.Time { return now }
			s.Tokens.Touch("t1")
			w := transportCall(s, tok, "", "initialize")
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			now = now.Add(24 * time.Hour)
			remaining := 0
			switch trigger {
			case "initialize":
				other := s.Tokens.Issue("t2")
				if w := transportCall(s, other, "", "initialize"); w.Code != 200 {
					t.Fatal(w.Code)
				}
				remaining = 1
			case "request":
				if w := transportCall(s, tok, w.Header().Get("Mcp-Session-Id"), "ping"); w.Code != 401 {
					t.Fatal(w.Code)
				}
			case "touch":
				s.Tokens.Touch("t1")
			}
			s.mu.Lock()
			count := len(s.sessions)
			s.mu.Unlock()
			if count != remaining {
				t.Fatalf("expired transports remain: %d sessions", count)
			}
		})
	}
}

func TestMCPTransportBelongsToCredential(t *testing.T) {
	s, tok := testServer()
	w := transportCall(s, tok, "", "initialize")
	other := s.Tokens.Issue("t2")
	if got := transportCall(s, other, w.Header().Get("Mcp-Session-Id"), "ping"); got.Code != 404 {
		t.Fatalf("another credential used the transport: %d", got.Code)
	}
}

func TestMCPRevokeDuringInitializeLeavesNoTransports(t *testing.T) {
	s, _ := testServer()
	for index := 0; index < 50; index++ {
		tok := s.Tokens.Issue("concurrent")
		start := make(chan struct{})
		var group sync.WaitGroup
		group.Add(2)
		go func() {
			defer group.Done()
			<-start
			transportCall(s, tok, "", "initialize")
		}()
		go func() {
			defer group.Done()
			<-start
			s.Tokens.Revoke(tok)
		}()
		close(start)
		group.Wait()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) != 0 {
		t.Fatalf("revoked initialization leaked %d transports", len(s.sessions))
	}
}
