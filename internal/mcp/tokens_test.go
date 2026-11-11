package mcp

import "testing"

func TestTokens(t *testing.T) {
	var ts Tokens
	a := ts.Issue("turn-1")
	if len(a) < 32 {
		t.Fatalf("token %q is too short", a)
	}
	if s, ok := ts.Resolve(a); !ok || s != "turn-1" {
		t.Fatalf("lookup = %v, %v", s, ok)
	}
	b := ts.Issue(nil) // started ahead, no turn yet
	if s, ok := ts.Resolve(b); !ok || s != nil {
		t.Fatalf("unbound lookup = %v, %v", s, ok)
	}
	ts.Revoke(a)
	if _, ok := ts.Resolve(a); ok {
		t.Fatal("revoked token still works")
	}
	if _, ok := ts.Resolve(""); ok {
		t.Fatal("empty token works")
	}
}
