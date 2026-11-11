// Package agents runs coding harnesses behind one interface. Each harness is a
// subpackage; internal/agents/all lists the ones faah is built with.
package agents

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotReadOnly means a harness has no read-only mode that passed the
// conformance test in explain_conformance_test.go.
var ErrNotReadOnly = errors.New("no verified read-only mode")

// Verified lists the harnesses whose read-only mode passed the conformance
// test. cursor-agent has a rewrite but has not yet passed, so it stays off
// until it does. Tests may replace the map.
var Verified = map[string]bool{"claude": true, "agy": true, "codex": true, "opencode": true}

// Caps says what a harness can do.
type Caps struct {
	Sessions     bool // remembers a conversation by session id, so a follow-up needs no replay
	NamesSession bool // picks its own session id and reports it, instead of being given one
}

// Turn is one prompt for a harness to answer.
type Turn struct {
	Dir       string
	Argv      []string // headless argv, already made read-only when it has to be
	Env       []string // extra KEY=VALUE entries
	Model     string
	Prompt    string
	SessionID string // "" when there is no session for this turn
	Resume    bool   // the session is live: continue it instead of starting it
	Timeout   time.Duration
	LogBytes  int
	Stderr    io.Writer
}

// Outcome is what a turn leaves behind for the next one.
type Outcome struct {
	SessionID string // the id the harness reported, "" when it reported none
	Live      bool   // the session exists now, so the next turn can resume it
}

// Sink receives a turn's output as it arrives.
type Sink interface {
	Text(text string, block bool) // block marks a whole message, set off by a blank line
	Step(label string)            // a tool the harness used, such as "Read auth.go"
	Result(text string)           // the final answer, used when nothing was streamed
}

// Agent is one coding harness.
type Agent interface {
	Name() string
	Caps() Caps
	// ReadOnly rewrites a headless argv so the harness cannot change files,
	// and returns any environment that needs. It fails with ErrNotReadOnly.
	ReadOnly(argv []string) ([]string, []string, error)
	// NewSession returns the id for a conversation's first turn, or "" when
	// the harness keeps no session or names its own.
	NewSession(ctx context.Context, dir string, argv []string) string
	// Run answers one turn and blocks until the harness exits.
	Run(ctx context.Context, t Turn, sink Sink) (Outcome, error)
}

// Warmable is an Agent that can be started before its prompt is known and be
// given the prompt on stdin later.
type Warmable interface {
	Agent
	TurnArgv(argv []string, sessionID string, resume bool) []string
	StdinArgv(argv []string) []string
	StdinMessage(prompt string) []byte
	Stream(sink Sink) *Stream
}
