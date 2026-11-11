# Explain in the Editor, Phase 0: Agent and Explain Packages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move harness-specific code into `internal/agents`, one package per harness behind one `Agent` interface, and move Explain's pure logic into `internal/explain`, with no change in behavior.

**Architecture:** `internal/agents` defines `Agent`, `Turn`, `Sink`, `Outcome`, `Caps`, and a `Stream` that turns harness output lines into sink calls. Each harness is a subpackage. `internal/agents/all` holds the explicit list and `For(name)`. Package `main` keeps threads, HTTP handlers, the standby, and the agent manager, and calls agents only through the interface. `internal/codeintel` holds the plain data types (`NavHit`, `CallNode`, `HoverInfo`, `Match`, `FileMatches`) so `internal/explain` does not import `main`; `main` keeps type aliases so its code does not change.

**Tech Stack:** Go 1.22+, `github.com/px0-ai/harness` v0.0.2, standard library only.

**Spec:** `docs/superpowers/specs/2026-11-11-explain-in-editor-design.md`, sections "Code structure" and phase 0.

**Rules for every task:**
- No behavior change. Do not edit any test assertion. A test may change only its package, imports, and the names of the functions it calls, when the function moved.
- Moved code keeps its comments. Rename identifiers only as the task says.
- After each task: `go build ./... && go vet ./... && go test ./...` passes, and `GOOS=windows go build ./...` passes.
- Commit messages: imperative, sentence case, no attribution lines.

---

## File map

| Path | Responsibility |
|---|---|
| `internal/codeintel/types.go` | `NavHit`, `CallNode`, `HoverInfo`, `Match`, `FileMatches` (moved from `lsp.go`, `search.go`) |
| `internal/agents/agent.go` | `Agent`, `Caps`, `Turn`, `Outcome`, `Sink`, `Event`, `Warmable`, `ErrNotReadOnly`, `Verified` |
| `internal/agents/stream.go` | `Stream`: lines to events to sink calls; `PlainText` parser |
| `internal/agents/label.go` | `ToolLabel` (moved `toolLabel`) |
| `internal/agents/exec.go` | `Exec`: runs a command through `harness.Run` with a `Stream` |
| `internal/agents/claude/claude.go` | claude adapter: session flags, stream-json parser, plan mode, stdin mode |
| `internal/agents/agy/agy.go` | agy adapter: conversation flags, parser, plan mode, stdin mode |
| `internal/agents/gemini/gemini.go` | gemini adapter: session flags, parser |
| `internal/agents/cursor/cursor.go` | cursor-agent adapter: `create-chat`, `--resume`, ask mode |
| `internal/agents/codex/codex.go` | codex adapter: read-only sandbox |
| `internal/agents/opencode/opencode.go` | opencode adapter: `faah-explain` agent and its config |
| `internal/agents/generic/generic.go` | any other harness: plain text, no sessions, no read-only mode |
| `internal/agents/all/all.go` | `List()` and `For(name)` |
| `internal/agents/all/contract_test.go` | contract test for every listed agent |
| `internal/explain/*.go` | request and target types, selection, link checks, prompt and packet, evidence gathering |
| `agent.go` | threads call agents; parsers, `threadArgv`, `threadNative`, `createCursorChat` removed |
| `explain_*.go` | HTTP handlers, thread glue, standby, runtime; call `internal/explain` |

---

### Task 1: Shared code intelligence types

**Files:**
- Create: `internal/codeintel/types.go`
- Modify: `lsp.go` (remove `NavHit` at lsp.go:1254, `HoverInfo` at lsp.go:1502, `CallNode` at lsp.go:1702), `search.go` (remove `Match` at search.go:26, `FileMatches` at search.go:100)
- Create: `codeintel_alias.go`

- [ ] **Step 1: Create the package with the five structs, moved verbatim with their comments and JSON tags**

```go
// Package codeintel holds the plain data that faah's language-server and
// search code produce, so packages outside main can use it.
package codeintel

// NavHit is one location a definition or reference request found.
type NavHit struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Pre  string `json:"pre"`
	Mid  string `json:"mid"`
	Post string `json:"post"`
	Def  bool   `json:"def,omitempty"`
	Ext  bool   `json:"ext,omitempty"` // outside the indexed tree, e.g. stdlib
}

type HoverInfo struct {
	Signature string `json:"signature"` // pre-highlighted HTML, one line per entry
	Doc       string `json:"doc"`
	Empty     bool   `json:"empty"`
}

type CallNode struct {
	Name     string `json:"name"`
	Detail   string `json:"detail,omitempty"`
	Kind     string `json:"kind"`
	Path     string `json:"path"` // where the function is declared
	Line     int    `json:"line"`
	Ext      bool   `json:"ext,omitempty"`
	SitePath string `json:"sitePath,omitempty"` // file holding the call expressions
	Sites    []int  `json:"sites,omitempty"`    // lines of those calls, ascending
	Item     string `json:"item"`               // CallHierarchyItem, returned as-is to expand
}

type Match struct {
	Line int    `json:"line"` // 1-based
	Pre  string `json:"pre"`
	Mid  string `json:"mid"`
	Post string `json:"post"`
	Def  bool   `json:"def,omitempty"` // line looks like a declaration
}

type FileMatches struct {
	Path    string  `json:"path"`    // Workspace-relative path to the file
	Matches []Match `json:"matches"` // List of snippet matches within this file
}
```

Copy each type's doc comment from its original location in `lsp.go` and `search.go` if it has one; the block above shows the fields that must match exactly.

- [ ] **Step 2: Add aliases in main so no other main code changes**

`codeintel_alias.go`:

```go
package main

import "faah/internal/codeintel"

// These types live in internal/codeintel so other packages can use them.
type (
	NavHit      = codeintel.NavHit
	HoverInfo   = codeintel.HoverInfo
	CallNode    = codeintel.CallNode
	Match       = codeintel.Match
	FileMatches = codeintel.FileMatches
)
```

- [ ] **Step 3: Delete the five original type declarations from `lsp.go` and `search.go`**

- [ ] **Step 4: Verify**

Run: `go build ./... && go vet ./... && go test ./... && GOOS=windows go build ./...`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add internal/codeintel codeintel_alias.go lsp.go search.go
git commit -m "Move code intelligence types into internal/codeintel"
```

---

### Task 2: Agent interface, stream, and exec helper

**Files:**
- Create: `internal/agents/agent.go`, `internal/agents/stream.go`, `internal/agents/label.go`, `internal/agents/exec.go`
- Test: `internal/agents/stream_test.go`, `internal/agents/label_test.go`

- [ ] **Step 1: Write the failing stream test**

`internal/agents/stream_test.go`:

```go
package agents

import (
	"strings"
	"testing"
)

type recSink struct{ log []string }

func (r *recSink) Text(s string, block bool) {
	if block {
		r.log = append(r.log, "block:"+s)
	} else {
		r.log = append(r.log, "text:"+s)
	}
}
func (r *recSink) Step(s string)   { r.log = append(r.log, "step:"+s) }
func (r *recSink) Result(s string) { r.log = append(r.log, "result:"+s) }

func TestStreamSplitsLinesAndReportsSession(t *testing.T) {
	parse := func(l string) []Event {
		switch l {
		case "S":
			return []Event{{Kind: EventSession, Text: "id1"}}
		case "T":
			return []Event{{Kind: EventTool, Text: "Read a.go"}}
		case "R":
			return []Event{{Kind: EventResult, Text: "done"}}
		}
		return []Event{{Kind: EventText, Text: l, Block: true}}
	}
	sink := &recSink{}
	st := NewStream(parse, sink)
	st.Write([]byte("S\nhel"))
	st.Write([]byte("lo\r\nT\nR\ntail"))
	out, err := st.Close()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(sink.log, " "); got != "block:hello step:Read a.go result:done block:tail" {
		t.Fatalf("log = %q", got)
	}
	if !out.Live || out.SessionID != "id1" {
		t.Fatalf("outcome = %+v", out)
	}
}

func TestStreamFailureBecomesError(t *testing.T) {
	st := NewStream(func(string) []Event { return []Event{{Kind: EventError, Text: "bad key"}} }, &recSink{})
	st.Write([]byte("x\n"))
	if _, err := st.Close(); err == nil || err.Error() != "bad key" {
		t.Fatalf("err = %v", err)
	}
}

func TestPlainTextKeepsLines(t *testing.T) {
	sink := &recSink{}
	st := NewStream(PlainText, sink)
	st.Write([]byte("a\nb"))
	out, _ := st.Close()
	if got := strings.Join(sink.log, "|"); got != "text:a\n|text:b\n" {
		t.Fatalf("log = %q", got)
	}
	if out.Live {
		t.Fatal("plain text never starts a session")
	}
}
```

`internal/agents/label_test.go`:

```go
package agents

import (
	"encoding/json"
	"testing"
)

func TestToolLabel(t *testing.T) {
	if got := ToolLabel("Edit", json.RawMessage(`{"file_path":"a.go"}`)); got != "Edit a.go" {
		t.Fatalf("got %q", got)
	}
	if got := ToolLabel("Think", nil); got != "Think" {
		t.Fatalf("got %q", got)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `go test ./internal/agents/`
Expected: FAIL, `undefined: Event`, `NewStream`, `ToolLabel`.

- [ ] **Step 3: Write `agent.go`**

```go
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
```

- [ ] **Step 4: Write `stream.go`**

```go
package agents

import (
	"bytes"
	"errors"
)

// Event kinds a parser reports.
const (
	EventSession = "session" // the harness started a session; Text is its id when it names one
	EventText    = "text"
	EventTool    = "tool"
	EventResult  = "result"
	EventError   = "error" // the harness's own error result
)

// Event is one thing a harness's output line means.
type Event struct {
	Kind  string
	Text  string
	Block bool
}

// PlainText is the parser for harnesses whose output is the answer itself.
func PlainText(line string) []Event {
	return []Event{{Kind: EventText, Text: line + "\n"}}
}

// Stream turns harness output into sink calls, one line at a time.
type Stream struct {
	parse   func(string) []Event
	sink    Sink
	buf     []byte
	out     Outcome
	failure string
}

func NewStream(parse func(string) []Event, sink Sink) *Stream {
	return &Stream{parse: parse, sink: sink}
}

func (s *Stream) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	for {
		i := bytes.IndexByte(s.buf, '\n')
		if i < 0 {
			break
		}
		line := s.buf[:i]
		s.buf = s.buf[i+1:]
		s.line(string(bytes.TrimRight(line, "\r")))
	}
	return len(p), nil
}

// Close handles a last line without a newline. The error is the harness's own
// error result, if it reported one.
func (s *Stream) Close() (Outcome, error) {
	if len(bytes.TrimSpace(s.buf)) > 0 {
		s.line(string(s.buf))
	}
	s.buf = nil
	if s.failure != "" {
		return s.out, errors.New(s.failure)
	}
	return s.out, nil
}

func (s *Stream) line(l string) {
	for _, ev := range s.parse(l) {
		switch ev.Kind {
		case EventSession:
			s.out.Live = true
			if ev.Text != "" {
				s.out.SessionID = ev.Text
			}
		case EventText:
			s.sink.Text(ev.Text, ev.Block)
		case EventTool:
			s.sink.Step(ev.Text)
		case EventError:
			s.failure = ev.Text
		case EventResult:
			s.sink.Result(ev.Text)
		}
	}
}
```

- [ ] **Step 5: Write `label.go`**

Move `toolLabel` from `agent.go:2102-2120` here verbatim, renamed `ToolLabel`, with its comment changed to start `// ToolLabel is`. Do not delete the original yet; Task 6 removes it.

- [ ] **Step 6: Write `exec.go`**

```go
package agents

import (
	"context"

	"github.com/px0-ai/harness"
)

// Exec runs argv through harness.Run, feeding its output through parse.
func Exec(ctx context.Context, name string, t Turn, argv []string, parse func(string) []Event, sink Sink) (Outcome, error) {
	st := NewStream(parse, sink)
	err := harness.Run(ctx, harness.Command{Name: name, Args: argv, Model: t.Model}, t.Prompt, harness.Options{
		Dir:      t.Dir,
		Timeout:  t.Timeout,
		LogBytes: t.LogBytes,
		Stdout:   st,
		Stderr:   t.Stderr,
		Env:      t.Env,
	}).Err
	out, ferr := st.Close()
	if err == nil {
		err = ferr
	}
	return out, err
}
```

- [ ] **Step 7: Run tests**

Run: `go test ./internal/agents/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/agents
git commit -m "Add the agent interface and output stream"
```

---

### Task 3: claude, agy, and gemini adapters

**Files:**
- Create: `internal/agents/claude/claude.go`, `internal/agents/agy/agy.go`, `internal/agents/gemini/gemini.go`
- Test: `internal/agents/claude/claude_test.go`, `internal/agents/agy/agy_test.go`, `internal/agents/gemini/gemini_test.go`

Rename rules for code moved in this task: `claudeEvent{kind: "x", text: t, block: b}` becomes `agents.Event{Kind: agents.EventX, Text: t, Block: b}`; `toolLabel` becomes `agents.ToolLabel`.

- [ ] **Step 1: Move the parser tests and add argv tests**

Move `TestParseClaudeEvent` (agent_test.go:897), `TestParseAgyEvent` (agent_test.go:915), and `TestParseGeminiEvent` (agent_test.go:933) into the three new test files. In each, replace `parseClaudeEvent(` with `parse(`, `e.kind` with `e.Kind`, `e.text` with `e.Text`, `evs[0].kind` with `evs[0].Kind`, and `evs[0].text` with `evs[0].Text`. The expected strings do not change.

Split the claude part of `TestThreadArgv` (agent_test.go:947) into `claude_test.go`:

```go
func TestTurnArgv(t *testing.T) {
	tpl := []string{"/bin/claude", "--permission-mode", "acceptEdits", "-p", "{prompt}"}
	first := strings.Join(New().TurnArgv(tpl, "U", false), " ")
	if !strings.Contains(first, "--session-id U") || strings.Contains(first, "--resume") || !strings.Contains(first, "stream-json") {
		t.Fatalf("first turn argv = %s", first)
	}
	next := strings.Join(New().TurnArgv(tpl, "U", true), " ")
	if !strings.Contains(next, "--resume U") || strings.Contains(next, "--session-id") {
		t.Fatalf("resume argv = %s", next)
	}
	if tpl[1] != "--permission-mode" {
		t.Fatal("TurnArgv mutated its template")
	}
}
```

Leave the rest of `TestThreadArgv` in `agent_test.go` for Task 4 and Task 6.

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./internal/agents/...`
Expected: FAIL, `undefined: parse`, `undefined: New`.

- [ ] **Step 3: Write `claude/claude.go`**

```go
// Package claude runs Claude Code.
package claude

import (
	"context"
	"encoding/json"
	"fmt"

	"faah/internal/agents"
	"github.com/px0-ai/harness"
)

const name = "claude"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string       { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--permission-mode", "plan")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return agents.NewUUID() }

// Run adds session flags only when the turn has a session, as threads did
// before this package: a turn without one runs its argv unchanged.
func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	argv := t.Argv
	if t.SessionID != "" {
		argv = a.TurnArgv(t.Argv, t.SessionID, t.Resume)
	}
	return agents.Exec(ctx, name, t, argv, parse, sink)
}

// TurnArgv adds the session and output flags a turn needs. Flag order does not
// matter to the CLI, so they go right after the binary.
func (*Agent) TurnArgv(argv []string, sessionID string, resume bool) []string {
	extra := []string{"--output-format", "stream-json", "--verbose"}
	if resume {
		extra = append(extra, "--resume", sessionID)
	} else {
		extra = append(extra, "--session-id", sessionID)
	}
	return agents.InsertAfterBinary(argv, extra)
}

// StdinArgv reads the prompt from stdin as one stream-json message.
func (*Agent) StdinArgv(argv []string) []string {
	return agents.StdinArgv(argv, harness.Placeholder)
}

func (*Agent) StdinMessage(prompt string) []byte {
	b, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": prompt}})
	return append(b, '\n')
}

func (*Agent) Stream(sink agents.Sink) *agents.Stream { return agents.NewStream(parse, sink) }
```

Move `parseClaudeEvent` (agent.go:1937-1989) into the same file as `func parse(line string) []agents.Event`, applying the rename rules.

`StdinMessage` produces exactly what `standbyMessage("claude", prompt)` in `explain_standby.go` produces today: `json.Marshal` sorts map keys, so both give `{"message":{…},"type":"user"}` and a newline.

- [ ] **Step 4: Add the argv helpers to `internal/agents/argv.go`**

```go
package agents

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// NewUUID returns a random version 4 UUID, the form claude and gemini accept
// as a session id. Moved from newUUID in agent.go.
func NewUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// SetFlag returns a copy of argv with flag's value replaced. ok is false when
// argv has no such flag.
func SetFlag(argv []string, flag, value string) ([]string, bool) {
	out := append([]string(nil), argv...)
	for i := 0; i+1 < len(out); i++ {
		if out[i] == flag {
			out[i+1] = value
			return out, true
		}
	}
	return out, false
}

// InsertAfterBinary returns argv with extra placed right after argv[0].
func InsertAfterBinary(argv, extra []string) []string {
	out := make([]string, 0, len(argv)+len(extra))
	out = append(out, argv[0])
	out = append(out, extra...)
	return append(out, argv[1:]...)
}

// StdinArgv makes a print-mode argv read its prompt as stream-json on stdin:
// it adds --input-format stream-json and empties the prompt placeholder.
// Moved from standbyArgv in explain_standby.go.
func StdinArgv(argv []string, placeholder string) []string {
	out := make([]string, 0, len(argv)+2)
	out = append(out, argv[0], "--input-format", "stream-json")
	for _, a := range argv[1:] {
		out = append(out, strings.ReplaceAll(a, placeholder, ""))
	}
	return out
}
```

`agent.go` keeps its own `newUUID` for thread ids until Task 6, which makes it call `agents.NewUUID`.

- [ ] **Step 5: Write `agy/agy.go`**

Same shape as claude, with these differences:
- `name = "agy"`, `Caps{Sessions: true, NamesSession: true}`.
- `ReadOnly`: `agents.SetFlag(argv, "--mode", "plan")`.
- `NewSession` returns `""`.
- `TurnArgv`: `extra := []string{"--output-format", "stream-json"}`, and when `resume && sessionID != ""` append `"--conversation", sessionID`.
- `StdinMessage`: `{"event":"user","message":{"role":"user","content":prompt}}` plus `'\n'`, matching `standbyMessage("agy", …)`.
- `parse` is the moved `parseAgyEvent` (agent.go:1991-2057).

- [ ] **Step 6: Write `gemini/gemini.go`**

- `name = "gemini"`, `Caps{Sessions: true}`.
- `ReadOnly` always returns `fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)`.
- `NewSession` returns `agents.NewUUID()`.
- `Run`: when `t.SessionID == ""`, `agents.Exec(ctx, name, t, t.Argv, parse, sink)`; otherwise `agents.Exec(ctx, name, t, turnArgv(t.Argv, t.SessionID, t.Resume), parse, sink)`, where `turnArgv` adds `--output-format stream-json`, then `--resume id` when `resume && id != ""`, else `--session-id id` when `id != ""`.
- `parse` is the moved `parseGeminiEvent` (agent.go:2059-2100).
- gemini does not implement `Warmable`.

- [ ] **Step 7: Run tests**

Run: `go test ./internal/agents/...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/agents
git commit -m "Add claude, agy and gemini agents"
```

---

### Task 4: cursor, codex, opencode, and generic adapters, and the list

**Files:**
- Create: `internal/agents/cursor/cursor.go`, `internal/agents/codex/codex.go`, `internal/agents/opencode/opencode.go`, `internal/agents/generic/generic.go`, `internal/agents/all/all.go`
- Test: `internal/agents/all/readonly_test.go`, `internal/agents/cursor/cursor_test.go`

- [ ] **Step 1: Move the read-only tests**

Move `TestReadOnlyArgvRefusesUnverified` and `TestReadOnlyArgv` from `explain_test.go` (around explain_test.go:355-405, and the `verifyHarnesses` helper they use) into `internal/agents/all/readonly_test.go`. Changes allowed:
- `readOnlyArgv(name, argv)` becomes `For(name).ReadOnly(argv)`, taking the first result for the argv and ignoring the env.
- `errHarnessNotReadOnly` becomes `agents.ErrNotReadOnly`.
- `verifyHarnesses` replaces `agents.Verified` instead of `explainVerified`. Keep a copy of `verifyHarnesses` in `explain_test.go` too, changed the same way, because `explainServer` uses it.

`TestExplainOpencodeRunsAsReadOnlyAgent` is a server test and stays in `explain_test.go` unchanged.

Add `internal/agents/cursor/cursor_test.go` from the cursor line of `TestThreadArgv`:

```go
func TestTurnArgvResumes(t *testing.T) {
	got := strings.Join(turnArgv([]string{"/bin/cursor-agent", "-p", "{prompt}"}, "C"), " ")
	if !strings.Contains(got, "--resume C") {
		t.Fatalf("cursor argv = %s", got)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./internal/agents/...`
Expected: FAIL, `undefined: For`, `undefined: turnArgv`.

- [ ] **Step 3: Write `cursor/cursor.go`**

- `name = "cursor-agent"`, `Caps{Sessions: true}`.
- `ReadOnly`: the cursor case of `readOnlyArgv` (explain_prompt.go, the `case "cursor-agent"` loop that replaces `--force` with `--mode ask`), then refuse unless `agents.Verified[name]`.
- `NewSession`: the body of `createCursorChat` (agent.go:1548-1562), with `bin = argv[0]` and `cmd.Dir = dir`.
- `turnArgv(argv, id)`: adds `--resume id` after the binary when `id != ""`.
- `Run`: `out, err := agents.Exec(ctx, name, t, turnArgv(t.Argv, t.SessionID), agents.PlainText, sink)`, then `out.Live = err == nil && t.SessionID != ""`, return. This keeps today's rule: a cursor session is live after a turn that ran natively and did not fail.

- [ ] **Step 4: Write `codex/codex.go`**

- `name = "codex"`, `Caps{}`.
- `ReadOnly`: `agents.SetFlag(argv, "--sandbox", "read-only")`, refuse unless found and verified.
- `NewSession` returns `""`.
- `Run`: `agents.Exec(ctx, name, t, t.Argv, agents.PlainText, sink)`.

- [ ] **Step 5: Write `opencode/opencode.go`**

- `name = "opencode"`, `Caps{}`.
- Move `opencodeExplainAgent` and `opencodeExplainConfig` (explain_prompt.go:141-160) here with their comment, as unexported `explainAgent` and `explainConfig`.
- `ReadOnly`: the opencode case of `readOnlyArgv` (requires `argv[1] == "run"`, inserts `--standalone --agent faah-explain` after `run`), and returns env `[]string{"OPENCODE_CONFIG_CONTENT=" + explainConfig}`, the same value `explainEnv("opencode")` returns. Refuse unless verified.
- `NewSession` returns `""`. `Run` is plain text, as codex.

- [ ] **Step 6: Write `generic/generic.go`**

```go
// Package generic runs any harness faah has no adapter for: plain text, no
// sessions, no read-only mode.
package generic

import (
	"context"
	"fmt"

	"faah/internal/agents"
)

type Agent struct{ name string }

func New(name string) *Agent { return &Agent{name: name} }

func (a *Agent) Name() string     { return a.name }
func (*Agent) Caps() agents.Caps { return agents.Caps{} }

func (a *Agent) ReadOnly([]string) ([]string, []string, error) {
	return nil, nil, fmt.Errorf("%s has %w", a.name, agents.ErrNotReadOnly)
}

func (*Agent) NewSession(context.Context, string, []string) string { return "" }

func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, a.name, t, t.Argv, agents.PlainText, sink)
}
```

- [ ] **Step 7: Write `all/all.go`**

```go
// Package all lists the agents faah is built with. Adding a harness is a new
// package under internal/agents and one line here.
package all

import (
	"faah/internal/agents"
	"faah/internal/agents/agy"
	"faah/internal/agents/claude"
	"faah/internal/agents/codex"
	"faah/internal/agents/cursor"
	"faah/internal/agents/gemini"
	"faah/internal/agents/generic"
	"faah/internal/agents/opencode"
)

// List returns one of each listed agent.
func List() []agents.Agent {
	return []agents.Agent{
		claude.New(),
		codex.New(),
		agy.New(),
		opencode.New(),
		cursor.New(),
		gemini.New(),
	}
}

// For returns the agent for a harness name, or a generic one.
func For(name string) agents.Agent {
	for _, a := range List() {
		if a.Name() == name {
			return a
		}
	}
	return generic.New(name)
}
```

- [ ] **Step 8: Run tests**

Run: `go test ./internal/agents/...`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add internal/agents explain_test.go
git commit -m "Add cursor, codex, opencode and generic agents"
```

---

### Task 5: Agent contract test

**Files:**
- Create: `internal/agents/all/contract_test.go`

- [ ] **Step 1: Write the contract test**

```go
package all

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

type sink struct{ text, steps []string }

func (s *sink) Text(t string, _ bool) { s.text = append(s.text, t) }
func (s *sink) Step(t string)         { s.steps = append(s.steps, t) }
func (s *sink) Result(t string)       { s.text = append(s.text, t) }

// fixture is one line of output each harness's parser understands as text.
var fixture = map[string]string{
	"claude": `{"type":"assistant","session_id":"s1","message":{"content":[{"type":"text","text":"hello"}]}}`,
	"agy":    `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hello"}}`,
	"gemini": `{"type":"message","role":"assistant","content":"hello"}`,
}

// Every listed agent runs a fake binary of its own name, for a first turn and
// a follow-up, and reports what it read.
func TestAgentContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake harness is a shell script")
	}
	seen := map[string]bool{}
	for _, a := range List() {
		a := a
		t.Run(a.Name(), func(t *testing.T) {
			if a.Name() == "" || seen[a.Name()] {
				t.Fatalf("name %q is empty or listed twice", a.Name())
			}
			seen[a.Name()] = true
			if For(a.Name()).Name() != a.Name() {
				t.Fatal("For does not find the listed agent")
			}
			dir := t.TempDir()
			line := fixture[a.Name()]
			if line == "" {
				line = "hello"
			}
			bin := filepath.Join(dir, a.Name())
			script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > args.txt\nprintf '%s\\n' '" + line + "'\n"
			if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			argv := []string{bin, "-p", "{prompt}"}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			sid := a.NewSession(ctx, dir, argv)
			for _, resume := range []bool{false, true} {
				s := &sink{}
				_, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", SessionID: sid, Resume: resume, Timeout: 5 * time.Second}, s)
				if err != nil {
					t.Fatalf("resume=%v: %v", resume, err)
				}
				if !strings.Contains(strings.Join(s.text, ""), "hello") {
					t.Fatalf("resume=%v: text = %q", resume, s.text)
				}
				args, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				if !strings.Contains(string(args), "say hello") {
					t.Fatalf("resume=%v: prompt not passed, args = %s", resume, args)
				}
			}
			// Without a session, an agent that is given its ids runs the argv unchanged.
			if c := a.Caps(); c.Sessions && !c.NamesSession {
				if _, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", Timeout: 5 * time.Second}, &sink{}); err != nil {
					t.Fatal(err)
				}
				args, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				if strings.Contains(string(args), "--session-id") || strings.Contains(string(args), "--resume") {
					t.Fatalf("no session, but args = %s", args)
				}
			}
			if _, _, err := a.ReadOnly(argv); err != nil && !strings.Contains(err.Error(), agents.ErrNotReadOnly.Error()) {
				t.Fatalf("ReadOnly error must wrap ErrNotReadOnly: %v", err)
			}
		})
	}
}
```

cursor-agent's `NewSession` runs `create-chat` on the fake binary, which prints `hello`; the test only needs a non-empty id, so this works without a branch for it.

- [ ] **Step 2: Run**

Run: `go test ./internal/agents/all/ -run TestAgentContract -v`
Expected: PASS for claude, codex, agy, opencode, cursor-agent, gemini. If one fails, fix the adapter, not the test.

- [ ] **Step 3: Commit**

```bash
git add internal/agents/all/contract_test.go
git commit -m "Test every listed agent against one contract"
```

---

### Task 6: Threads and the standby use agents

**Files:**
- Modify: `agent.go` (`Send` at agent.go:1480, `runTurn` at agent.go:1564, `threadSink` at agent.go:1815-1921, remove agent.go:1364-1407, 1548-1562, 1929-2120)
- Modify: `explain_standby.go`, `explain_prompt.go` (remove `explainVerified`, `opencodeExplain*`, `explainEnv`, `readOnlyArgv`), `explain.go:55` (`errHarnessNotReadOnly`)
- Modify tests: `agent_test.go` (remove moved tests; keep the codex line of `TestThreadArgv` only if it still has a subject, otherwise delete the rest), `explain_conformance_test.go`, `explain_bench_test.go`

- [ ] **Step 1: Make `threadSink` an `agents.Sink`**

Delete `buf`, `harness`, `started`, `sessionID`, `failure`, `Write`, `flush`, `line`, and `handleEvent`. Keep `text` and `tool`, and add:

```go
func (s *threadSink) Text(text string, block bool) { s.text(text, block) }
func (s *threadSink) Step(label string)            { s.tool(label) }

// Result is the final answer, kept only when nothing was streamed.
func (s *threadSink) Result(text string) {
	if strings.TrimSpace(s.reply()) == "" {
		s.text(text, true)
	}
}
```

- [ ] **Step 2: `errHarnessNotReadOnly` points at the agents error**

In `explain.go:55`, replace the `errors.New` with `errHarnessNotReadOnly = agents.ErrNotReadOnly`.

- [ ] **Step 3: `Send` uses the agent's read-only rewrite**

Replace the `readOnlyArgv(name, base)` block in `Send` with:

```go
	var env []string
	if t.Kind == "explain" {
		readOnly, e, err := all.For(name).ReadOnly(base)
		if err != nil {
			tm.mu.Unlock()
			return nil, err
		}
		base, env = readOnly, e
	}
```

Add `env []string` to `threadRun`, and pass `env: env` where `Send` builds it.

- [ ] **Step 4: `runTurn` uses the agent**

Replace the session and run code in `runTurn` with the following, keeping every other line as it is:

```go
	a := all.For(r.name)
	caps := a.Caps()
	var standby *standbyProc
	if explaining && sessionID == "" && len(r.prior) == 0 {
		if standby = tm.standby.take(standbyKey(r.name, r.base)); standby != nil {
			sessionID = standby.sessionID
		}
	}
	if sessionID == "" && caps.Sessions {
		sessionID = a.NewSession(ctx, tm.root, r.base)
	}
	native := caps.Sessions && (sessionID != "" || caps.NamesSession)
	replay := len(r.prior) > 0 && !(native && live)
```

and the run itself:

```go
	sink := &threadSink{tm: tm, tid: r.tid, turn: r.turn, began: started}
	turnSession := ""
	if native {
		turnSession = sessionID
	}
	var out agents.Outcome
	var err error
	if w, ok := a.(agents.Warmable); ok && standby != nil {
		st := w.Stream(sink)
		err = standby.run(ctx, prompt, st, stderr, threadTurnTimeout)
		var ferr error
		out, ferr = st.Close()
		if err == nil {
			err = ferr
		}
		go tm.warmExplain() // ready for the next one
	} else {
		out, err = a.Run(ctx, agents.Turn{
			Dir: tm.root, Argv: r.base, Env: r.env, Model: r.model, Prompt: prompt,
			SessionID: turnSession, Resume: live, Timeout: threadTurnTimeout,
			LogBytes: agentLogBytes, Stderr: stderr,
		}, sink)
	}
```

A non-native turn runs `r.base` unchanged, as before: `turnSession` is `""`, and claude, gemini, and cursor add session flags only when the turn has a session id. agy always adds its output flags, as `threadArgv` did, because agy is native even without an id.

After the run, replace the session bookkeeping with:

```go
		if t.SessionID == "" && out.SessionID != "" {
			t.SessionID = out.SessionID
		}
		if out.Live {
			t.SessionLive = true
		}
```

Remove the `sink.flush()` call and the `sink.failure` check; `Stream.Close` covers both. Keep `refs = validateExplainRefs(tm.root, sink.reply())`.

- [ ] **Step 5: The standby uses `Warmable`**

In `warmExplain` (explain_standby.go), replace the name check, `readOnlyArgv`, the claude UUID, and `standbyArgv(threadArgv(...))` with:

```go
	name, base, _ := tm.explainHarness()
	w, ok := all.For(name).(agents.Warmable)
	if base == nil || !ok {
		sb.stop()
		return
	}
	ro, _, err := w.ReadOnly(base)
	if err != nil {
		sb.stop()
		return
	}
	key := standbyKey(name, ro)
	…
	sessionID := w.NewSession(context.Background(), tm.root, ro)
	sp, err := startStandby(tm.root, name, key, sessionID, w.StdinArgv(w.TurnArgv(ro, sessionID, false)))
```

`standbyProc.run` writes `w.StdinMessage(prompt)` instead of `standbyMessage(name, prompt)`; store `w` on the `standbyProc` when it starts. Delete `standbyArgv` and `standbyMessage`. Change `TestStandbyArgvReadsPromptFromStdin` to call `claude.New().StdinArgv`, with no other change.

- [ ] **Step 6: Delete the moved code from main**

Make `newUUID` in `agent.go` return `agents.NewUUID()`; it still names threads. Delete `threadNative`, `threadArgv`, `createCursorChat`, `claudeEvent`, `parseClaudeEvent`, `parseAgyEvent`, `parseGeminiEvent`, `toolLabel` (replace any remaining caller with `agents.ToolLabel`), `explainVerified`, `opencodeExplainAgent`, `opencodeExplainConfig`, `explainEnv`, and `readOnlyArgv`. Remove the tests that moved in Tasks 3 and 4 from `agent_test.go` and `explain_test.go`. In `explain_conformance_test.go` and `explain_bench_test.go`, replace `readOnlyArgv(name, argv)` with `all.For(name).ReadOnly(argv)` and `explainEnv(name)` with the env it returns.

- [ ] **Step 7: Verify everything**

Run: `go build ./... && go vet ./... && go test ./... && go test -race -run 'Thread|Explain|Standby' . && GOOS=windows go build ./... && go vet -tags harness ./...`
Expected: all pass. `TestThreadClaudeSessionResume`, `TestThreadConversationWithPlainHarness`, `TestExplainStandby*`, and `TestExplainAPIRunsReadOnlyAndReuses` must pass without assertion changes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Run thread turns through the agent interface"
```

---

### Task 7: Explain package

**Files:**
- Create: `internal/explain/types.go`, `selection.go`, `refs.go`, `prompt.go`, `evidence.go`, `symbol.go`, and their tests
- Modify: `explain.go`, `explain_evidence.go` (removed), `explain_symbol.go` (removed), `explain_refs.go` (removed), `explain_selection.go` (removed), `explain_prompt.go` (removed), `explain_threads.go`, `explain_runtime.go`, `agent.go`

Moves and renames:

| From | To `internal/explain` |
|---|---|
| `explain.go` consts (kinds, limits), `explainKeywords`, `explainRequest`, `explainTarget`, `explainSummary`, `validatedRef` | `types.go`: `KindBlock`…, `Request`, `Target`, `Summary`, `Ref` |
| `explain_selection.go` | `selection.go`: `Classify`, `ReadLines`, `utf16Len`, `sliceColumns`, `columnlessMatches` |
| `explain_refs.go` | `refs.go`: `Resolve`, `ValidateRefs`, and the unexported helpers |
| `explain_prompt.go` (what is left after Task 6) | `prompt.go`: `Instructions`, `BuildPacket`, `Key`, `HashList`, `StaleReason`, `PromptVersion`, and the unexported helpers |
| `explain_evidence.go`, `explain_symbol.go` | `evidence.go`, `symbol.go`: `Gather`, `Evidence`, `Section`, and the unexported gatherer |
| `codeIntel` and `explainDeps` | `evidence.go`: `Workspace` interface, below |

```go
// Workspace is what gathering evidence needs from faah: code intelligence,
// search, and file access.
type Workspace interface {
	Definition(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	References(ctx context.Context, abs, rel string, line, col int) ([]codeintel.NavHit, error)
	Hover(ctx context.Context, abs, rel string, line, col int) (*codeintel.HoverInfo, error)
	Symbols(ctx context.Context, abs, rel string) ([]symbols.Symbol, error)
	PrepareCalls(ctx context.Context, abs, rel string, line, u16col int) ([]codeintel.CallNode, error)
	Calls(ctx context.Context, rel, item string, outgoing bool) ([]codeintel.CallNode, error)
	Ready(ctx context.Context, abs, rel string) string // server name, "" when none is ready
	Outline(abs, rel string) ([]symbols.Symbol, error)
	Search(ctx context.Context, name string) []codeintel.FileMatches
	Abs(rel string) (string, bool)
}
```

- [ ] **Step 1: Move the pure tests first**

Move the tests in `explain_test.go` that call only the functions in the table into `internal/explain/*_test.go`, renaming the calls. These are the packet, key and hash, stale reason, instruction, selection, and link-check tests (for example `TestExplainPacketNumbersBlockFromItsFirstLine`, `TestExplainPacketLimit`, `TestExplainKeyAndHash`, `TestValidateExplainRefs`, `TestExplainInstructionsLeaveLengthToTheReader`). Tests that need a `Server`, threads, or a fake harness stay in `explain_test.go`. Evidence tests that use a fake `codeIntel` get a fake `Workspace` with the same answers.

- [ ] **Step 2: Run to verify they fail**

Run: `go test ./internal/explain/`
Expected: FAIL with undefined names.

- [ ] **Step 3: Move the code**

Move each file as in the table, export the names listed, and keep everything else unexported. `Gather(ctx, ws Workspace, t Target, lines []string) Evidence` replaces `gatherExplain(ctx, deps, t, lines)`; inside, `g.deps.intel.X` becomes `g.ws.X`, `g.deps.ready` becomes `g.ws.Ready`, `g.deps.outline` becomes `g.ws.Outline`, `g.deps.search` becomes `g.ws.Search`, and `g.deps.abs` becomes `g.ws.Abs`.

- [ ] **Step 4: Main implements `Workspace`**

Replace `func (s *Server) explainDeps() explainDeps` with a type in `explain.go`:

```go
// explainWorkspace is the Server as Explain sees it.
type explainWorkspace struct{ s *Server }

func (w explainWorkspace) Definition(ctx context.Context, abs, rel string, line, col int) ([]NavHit, error) {
	return w.s.lsp.Definition(ctx, abs, rel, line, col)
}
```

and so on for `References`, `Hover`, `Symbols`, `PrepareCalls`, `Calls`, each forwarding to `w.s.lsp`. `Ready` is the body of the old `ready` closure, `Outline` calls `symbols.Outline`, `Search` is the old `search` closure, and `Abs` is the old `abs` closure. Callers of `s.explainDeps()` pass `explainWorkspace{s}`.

- [ ] **Step 5: Update the glue**

In `explain.go`, `explain_threads.go`, `explain_runtime.go`, `explain_standby.go`, and `agent.go`, use the `explain.` names. The thread fields keep their JSON tags: `Evidence *explain.Summary` and `ExplainReq *explain.Request`. `threadPrompt` calls `explain.Instructions(t.ExplainKind, t.ExplainReader)`.

- [ ] **Step 6: Verify everything**

Run: `go build ./... && go vet ./... && go test ./... && go test -race -run 'Explain' . ./internal/explain/ && GOOS=windows go build ./... && go vet -tags harness ./...`
Expected: all pass.

- [ ] **Step 7: Check that `internal/explain` stands alone**

Run: `go list -deps ./internal/explain | grep -v '^faah/internal' | grep '^faah'`
Expected: no output. The package must not depend on `faah` (main).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move Explain logic into internal/explain"
```

---

### Task 8: Docs, verification, and pull request

**Files:**
- Modify: `docs/internals/threads.md:5-7`, `docs/internals/architecture.md:77`, `docs/agents/README.md:34-35`

- [ ] **Step 1: Update the file references**

- `docs/internals/threads.md`: the turn runner is in `agent.go`; harness specifics are in `internal/agents/<name>/`, listed in `internal/agents/all/all.go`; Explain logic is in `internal/explain`.
- `docs/internals/architecture.md`: add `internal/agents`, `internal/codeintel`, and `internal/explain` to the package list, one line each.
- `docs/agents/README.md`: add `internal/agents/` to the Harness Editing and Threads rows.
- Add a short "Adding a harness" paragraph to `docs/internals/threads.md`: create `internal/agents/<name>/` with an `Agent`, add it to `all.List()`, and add a fixture line to the contract test if its output is not plain text.

- [ ] **Step 2: Full verification**

Run: `go test -count=1 ./... && npm run -s check && npm run -s build && GOOS=windows go build ./... && go vet -tags harness ./...`
Expected: all pass.

- [ ] **Step 3: Commit, push, and open the pull request**

```bash
git add docs
git commit -m "Point the docs at the agent and Explain packages"
git push -u origin explain-in-editor
gh pr create --base main --title "Move agents and Explain into packages" --body-file <prepared body>
```

The body lists the new packages, says there is no behavior change, and names the tests that moved. It has no attribution lines.
