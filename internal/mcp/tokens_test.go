package mcp

import "testing"

func TestTokens(t *testing.T) {
	var ts Tokens
	a := ts.Issue("turn-1")
	if len(a) < 32 {
		t.Fatalf("token %q is too short", a)
	}
	if s, ok := ts.Lookup(a); !ok || s != "turn-1" {
		t.Fatalf("lookup = %v, %v", s, ok)
	}
	b := ts.Issue(nil) // started ahead, no turn yet
	if s, ok := ts.Lookup(b); !ok || s != nil {
		t.Fatalf("unbound lookup = %v, %v", s, ok)
	}
	if !ts.Bind(b, "turn-2") {
		t.Fatal("bind failed")
	}
	if s, _ := ts.Lookup(b); s != "turn-2" {
		t.Fatalf("bound scope = %v", s)
	}
	ts.Revoke(a)
	if _, ok := ts.Lookup(a); ok {
		t.Fatal("revoked token still works")
	}
	if ts.Bind(a, "x") {
		t.Fatal("bound a revoked token")
	}
	if _, ok := ts.Lookup(""); ok {
		t.Fatal("empty token works")
	}
}
