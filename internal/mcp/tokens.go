// Package mcp serves faah tools over Streamable HTTP.
package mcp

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"reflect"
	"sync"
	"time"
)

type credential struct {
	scope any
	alive time.Time
}
type Tokens struct {
	mu  sync.Mutex
	m   map[[32]byte]credential
	now func() time.Time
}

func (ts *Tokens) clock() time.Time {
	if ts.now != nil {
		return ts.now()
	}
	return time.Now()
}
func (ts *Tokens) Issue(scope any) string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	tok := base64.RawURLEncoding.EncodeToString(b[:])
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.m == nil {
		ts.m = map[[32]byte]credential{}
	}
	ts.m[sha256.Sum256([]byte(tok))] = credential{scope, ts.clock()}
	return tok
}
func (ts *Tokens) Resolve(tok string) (any, bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	h := sha256.Sum256([]byte(tok))
	c, ok := ts.m[h]
	if !ok || tok == "" || ts.clock().Sub(c.alive) >= 24*time.Hour {
		return nil, false
	}
	c.alive = ts.clock()
	ts.m[h] = c
	return c.scope, true
}
func (ts *Tokens) Touch(scope any) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for h, c := range ts.m {
		if reflect.DeepEqual(c.scope, scope) {
			c.alive = ts.clock()
			ts.m[h] = c
		}
	}
}
func (ts *Tokens) Revoke(tok string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	delete(ts.m, sha256.Sum256([]byte(tok)))
}
func (ts *Tokens) RevokeScope(match func(any) bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for h, c := range ts.m {
		if match(c.scope) {
			delete(ts.m, h)
		}
	}
}
func (ts *Tokens) Lookup(tok string) (any, bool) { return ts.Resolve(tok) }
func (ts *Tokens) Bind(tok string, scope any) bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	h := sha256.Sum256([]byte(tok))
	c, ok := ts.m[h]
	if !ok {
		return false
	}
	c.scope = scope
	ts.m[h] = c
	return true
}
