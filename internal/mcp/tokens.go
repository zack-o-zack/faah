// Package mcp serves tools to coding harnesses over the Model Context
// Protocol's Streamable HTTP transport, answering every request in JSON.
package mcp

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Tokens maps bearer tokens to what each one acts for. A token issued with a
// nil scope works for the handshake but not for tool calls until it is bound.
type Tokens struct {
	mu sync.Mutex
	m  map[string]any
}

func (ts *Tokens) Issue(scope any) string {
	var b [24]byte
	rand.Read(b[:])
	tok := hex.EncodeToString(b[:])
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.m == nil {
		ts.m = map[string]any{}
	}
	ts.m[tok] = scope
	return tok
}

// Bind sets the scope of a live token.
func (ts *Tokens) Bind(tok string, scope any) bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if _, ok := ts.m[tok]; !ok {
		return false
	}
	ts.m[tok] = scope
	return true
}

func (ts *Tokens) Lookup(tok string) (any, bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	s, ok := ts.m[tok]
	return s, ok && tok != ""
}

func (ts *Tokens) Revoke(tok string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	delete(ts.m, tok)
}
