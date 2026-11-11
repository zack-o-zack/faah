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

// Tokens holds hashed, scoped credentials with a 24-hour idle expiry.
type Tokens struct {
	mu      sync.Mutex
	m       map[[32]byte]credential
	now     func() time.Time
	servers map[*Server]struct{}
}

func (ts *Tokens) clock() time.Time {
	if ts.now != nil {
		return ts.now()
	}
	return time.Now()
}

// Issue creates a credential bound to scope.
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

// Resolve validates a credential and refreshes its idle expiry.
func (ts *Tokens) Resolve(tok string) (any, bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	h := sha256.Sum256([]byte(tok))
	c, ok := ts.m[h]
	if !ok || tok == "" {
		return nil, false
	}
	if ts.clock().Sub(c.alive) >= 24*time.Hour {
		ts.dropSessionsLocked(h)
		return nil, false
	}
	c.alive = ts.clock()
	ts.m[h] = c
	return c.scope, true
}

// Touch refreshes credentials bound to scope.
func (ts *Tokens) Touch(scope any) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for h, c := range ts.m {
		if reflect.DeepEqual(c.scope, scope) {
			if ts.clock().Sub(c.alive) >= 24*time.Hour {
				ts.dropSessionsLocked(h)
			}
			c.alive = ts.clock()
			ts.m[h] = c
		}
	}
}

// Revoke invalidates one credential.
func (ts *Tokens) Revoke(tok string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	hash := sha256.Sum256([]byte(tok))
	delete(ts.m, hash)
	ts.dropSessionsLocked(hash)
}

// RevokeScope invalidates credentials whose scopes match.
func (ts *Tokens) RevokeScope(match func(any) bool) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for h, c := range ts.m {
		if match(c.scope) {
			delete(ts.m, h)
			ts.dropSessionsLocked(h)
		}
	}
}

func (ts *Tokens) validLocked(hash [32]byte) bool {
	credential, ok := ts.m[hash]
	return ok && ts.clock().Sub(credential.alive) < 24*time.Hour
}

func (ts *Tokens) dropSessionsLocked(hash [32]byte) {
	for server := range ts.servers {
		server.mu.Lock()
		for sid, owner := range server.sessions {
			if owner == hash {
				delete(server.sessions, sid)
			}
		}
		if len(server.sessions) == 0 {
			delete(ts.servers, server)
		}
		server.mu.Unlock()
	}
}
