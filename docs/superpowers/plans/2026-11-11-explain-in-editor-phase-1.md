# Explain in the Editor, Phase 1: Tools and the MCP Endpoint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explanations can call `annotate` and `walkthrough`. faah checks each call, saves what passed with the turn, finds it again when the code moves, marks it outdated when the code or a symbol's uses change, and lists it in the thread.

**Architecture:** `internal/mcp` is a small Streamable HTTP MCP server with bearer tokens, mounted at `/api/mcp`. `internal/explain/notes` holds the tool schemas, the checks, the tagged-block reader, and the code that finds saved notes again. `internal/agents` gains a tool channel per agent (`ToolsMCP` for claude and codex, `ToolsTagged` for opencode and, until phase 2, agy) and a `Tools` endpoint on `Turn`. Package `main` issues one token per explain turn, records tool calls on the turn, and serves `GET /api/explain/notes`.

**Tech Stack:** Go standard library, `github.com/px0-ai/harness`, plain JavaScript in `web/src`.

**Spec:** `docs/superpowers/specs/2026-11-11-explain-in-editor-design.md`, sections Tools, Delivery (MCP endpoint, Tagged blocks), Checks, Saving and staleness, and phase 1.

**Verified before planning (2026-11-11):** claude in plan mode with `--mcp-config '{"mcpServers":{"faah":{"type":"http","url":…,"headers":{"Authorization":"Bearer …"}}}}' --strict-mcp-config`, and codex with `--sandbox read-only -c mcp_servers.faah.url="…" -c 'mcp_servers.faah.http_headers={Authorization="Bearer …"}'`, both called both tools on a Python HTTP endpoint that answers in JSON. claude also sends `server/discover`.

**Rules for every task:** `go build ./... && go vet ./... && go test ./...` passes after the task, and `GOOS=windows go build ./...` passes. Commit messages are imperative, sentence case, with no attribution lines. Code comments match the surrounding density.

---

## File map

| Path | Responsibility |
|---|---|
| `internal/mcp/tokens.go` | `Tokens`: issue, bind, look up, revoke |
| `internal/mcp/server.go` | `Server`, `Tool`: JSON-RPC over HTTP POST, answers in JSON |
| `internal/explain/notes/notes.go` | `Note`, `Step`, `Walkthrough`, `Reader`, `DiskReader` |
| `internal/explain/notes/check.go` | `CheckNotes`, `CheckWalkthrough` |
| `internal/explain/notes/tools.go` | tool schemas, `Recorder`, `Apply`, `Tools` (for `mcp.Server`), `Prompt` |
| `internal/explain/notes/tagged.go` | `Tagged`: a sink that pulls `<faah:…>` blocks out of streamed text |
| `internal/explain/notes/locate.go` | `Locate`: find saved text in the file as it is now |
| `internal/agents/agent.go` | `ToolChannel`, `Caps.Tools`, `ToolEndpoint`, `Turn.Tools`; `Warmable.TurnArgv(Turn)` |
| `internal/agents/claude`, `codex` | MCP flags when `Turn.Tools` is set |
| `internal/agents/agy`, `opencode` | `Caps.Tools = ToolsTagged` |
| `internal/explain/types.go` | `explainPromptVersion = 2` |
| `explain_tools.go` (new, main) | token scope, `Recorder` on `threadManager`, symbol hashes, `/api/mcp`, `/api/explain/notes` |
| `agent.go`, `explain_standby.go`, `server.go`, `main.go` | wiring |
| `web/src/thread.js`, `web/style.css` | notes and walkthroughs listed under the reply |

---

### Task 1: Tokens

**Files:** Create `internal/mcp/tokens.go`; Test `internal/mcp/tokens_test.go`

- [ ] **Step 1: Write the failing test**

```go
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
```

- [ ] **Step 2: Run it; expect FAIL** (`go test ./internal/mcp/`: undefined `Tokens`)

- [ ] **Step 3: Implement**

```go
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
```

- [ ] **Step 4: Run; expect PASS.** **Step 5: Commit** `git add internal/mcp && git commit -m "Add MCP bearer tokens"`

---

### Task 2: MCP server

**Files:** Create `internal/mcp/server.go`; Test `internal/mcp/server_test.go`

- [ ] **Step 1: Write the failing test**

```go
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
	w := httptest.NewRecorder()
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
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET = %d", w.Code)
	}
	if code, m := post(t, s, tok, `not json`); code != 200 || m["error"].(map[string]any)["code"].(float64) != -32700 {
		t.Fatalf("parse error = %d %v", code, m)
	}
}
```

- [ ] **Step 2: Run; expect FAIL** (undefined `Server`).

- [ ] **Step 3: Implement**

```go
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
	scope, ok := s.Tokens.Lookup(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if !ok {
		http.Error(w, "unknown token", http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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
```

- [ ] **Step 4: Run; expect PASS.** **Step 5: Commit** `git commit -m "Add an MCP server that answers in JSON"`

---

### Task 3: Notes, checks, and finding them again

**Files:** Create `internal/explain/notes/notes.go`, `check.go`, `locate.go`; Test `internal/explain/notes/check_test.go`, `locate_test.go`

- [ ] **Step 1: Write the failing tests**

`check_test.go`:

```go
package notes

import (
	"strings"
	"testing"
)

var auth = strings.Split("package main\n\n// checkToken reads the header.\nfunc checkToken(h string) bool {\n\treturn h != \"\"\n}\n\nfunc handle() {\n\tcheckToken(\"x\")\n}", "\n")

func read(rel string) ([]string, bool) {
	if rel == "auth.go" {
		return auth, true
	}
	return nil, false
}

func TestCheckNotes(t *testing.T) {
	in := []Note{
		{Kind: "symbol", Path: "auth.go", L1: 4, L2: 6, Symbol: "checkToken", Summary: "  Reads the header.  "},
		{Kind: "symbol", Path: "auth.go", L1: 2, L2: 2, Symbol: "checkToken", Summary: "Snaps to line 3."},
		{Kind: "block", Path: "auth.go", L1: 8, L2: 10, Summary: strings.Repeat("x", 200), Detail: strings.Repeat("d", 5000)},
		{Kind: "line", Path: "auth.go", L1: 40, L2: 40, Summary: "past the end"},
		{Kind: "symbol", Path: "auth.go", L1: 9, L2: 9, Symbol: "missing", Summary: "no such name"},
		{Kind: "symbol", Path: "auth.go", L1: 1, L2: 1, Symbol: "handle", Summary: "far away"},
		{Kind: "line", Path: "../etc/passwd", L1: 1, L2: 1, Summary: "outside"},
		{Kind: "box", Path: "auth.go", L1: 1, L2: 1, Summary: "bad kind"},
		{Kind: "line", Path: "auth.go", L1: 1, L2: 1, Summary: "  "},
	}
	ok, errs := CheckNotes(read, in)
	if len(ok) != 3 {
		t.Fatalf("kept %d notes: %+v\nerrors: %v", len(ok), ok, errs)
	}
	if n := ok[0]; n.L1 != 4 || n.L2 != 4 || n.Summary != "Reads the header." || n.Text != "func checkToken(h string) bool {" {
		t.Fatalf("symbol note = %+v", n)
	}
	if n := ok[1]; n.L1 != 4 || n.L2 != 4 {
		t.Fatalf("snapped note = %+v", n)
	}
	if n := ok[2]; len([]rune(n.Summary)) != 120 || len(n.Detail) != 4000 || n.Text != "func handle() {\n\tcheckToken(\"x\")\n}" {
		t.Fatalf("block note = %+v", n)
	}
	want := []string{
		"notes[3]: auth.go:40 is past the end of the file (10 lines)",
		"notes[4]: missing is not in auth.go",
		"notes[5]: handle is not on auth.go:1; it is on line 8",
		"notes[6]: ../etc/passwd is not a file in the workspace",
		"notes[7]: kind must be symbol, line or block",
		"notes[8]: summary is empty",
	}
	if strings.Join(errs, "\n") != strings.Join(want, "\n") {
		t.Fatalf("errors:\n%s\nwant:\n%s", strings.Join(errs, "\n"), strings.Join(want, "\n"))
	}
	if _, errs := CheckNotes(read, nil); len(errs) != 1 || errs[0] != "annotate takes 1 to 100 notes" {
		t.Fatalf("empty call = %v", errs)
	}
}

func TestCheckWalkthrough(t *testing.T) {
	w := Walkthrough{Title: "Login", Steps: []Step{
		{Path: "auth.go", L1: 8, L2: 10, Title: "Handler", Body: "Calls checkToken."},
		{Path: "auth.go", L1: 4, L2: 6, Title: "Check", Body: "Reads the header."},
	}}
	got, err := CheckWalkthrough(read, w)
	if err != nil || got.Steps[1].Text != "func checkToken(h string) bool {\n\treturn h != \"\"\n}" {
		t.Fatalf("walkthrough = %+v, %v", got, err)
	}
	w.Steps[1].L2 = 99
	if _, err := CheckWalkthrough(read, w); err == nil || err.Error() != "step 2: auth.go:4-99 is past the end of the file (10 lines)" {
		t.Fatalf("bad step error = %v", err)
	}
	if _, err := CheckWalkthrough(read, Walkthrough{Title: "x", Steps: w.Steps[:1]}); err == nil || err.Error() != "a walkthrough has 2 to 20 steps" {
		t.Fatalf("one step error = %v", err)
	}
}
```

`locate_test.go`:

```go
package notes

import "testing"

func TestLocate(t *testing.T) {
	lines := []string{"a", "x", "y", "b", "x", "y"}
	if l1, l2, ok := Locate(lines, "x\ny", 5); !ok || l1 != 5 || l2 != 6 {
		t.Fatalf("nearest = %d-%d %v", l1, l2, ok)
	}
	if l1, _, ok := Locate(lines, "x\ny", 1); !ok || l1 != 2 {
		t.Fatalf("first = %d %v", l1, ok)
	}
	if _, _, ok := Locate(lines, "gone", 1); ok {
		t.Fatal("found missing text")
	}
}
```

- [ ] **Step 2: Run; expect FAIL** (`go test ./internal/explain/notes/`: undefined names).

- [ ] **Step 3: Implement `notes.go`**

```go
// Package notes is what the explain tools show on the code: notes on a
// symbol, a line or a block, and walkthroughs of a flow. It checks each call,
// and finds saved notes again in code that has moved.
package notes

import "faah/internal/explain"

// Note explains one symbol, line or block in place.
type Note struct {
	Kind    string `json:"kind"` // symbol, line or block
	Path    string `json:"path"`
	L1      int    `json:"l1"`
	L2      int    `json:"l2"`
	Symbol  string `json:"symbol,omitempty"`
	Summary string `json:"summary"`
	Detail  string `json:"detail,omitempty"`
	Text    string `json:"text"`           // the lines when saved, to find them again
	Refs    string `json:"refs,omitempty"` // a symbol's callers and references hash when saved
}

// Step is one stop of a walkthrough.
type Step struct {
	Path  string `json:"path"`
	L1    int    `json:"l1"`
	L2    int    `json:"l2"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Text  string `json:"text"`
}

// Walkthrough guides the reader through a flow, one step at a time.
type Walkthrough struct {
	Title string `json:"title"`
	Steps []Step `json:"steps"`
}

// Reader returns a workspace file's lines, or false when rel is not a
// readable file inside the workspace.
type Reader func(rel string) ([]string, bool)

// DiskReader reads files under root, refusing paths that lead out of it.
func DiskReader(root string) Reader {
	return func(rel string) ([]string, bool) {
		abs, ok := explain.Resolve(root, rel)
		if !ok {
			return nil, false
		}
		lines, err := explain.ReadLines(abs)
		return lines, err == nil
	}
}
```

`explain.Resolve` does not exist yet: rename `explainResolve` in `internal/explain/refs.go` to exported `Resolve`, keeping its comment, and update its callers in that file.

- [ ] **Step 4: Implement `check.go`**

```go
package notes

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	maxNotes   = 100
	maxSteps   = 20
	maxSummary = 120 // runes
	maxBody    = 4000
	snapLines  = 3
)

// CheckNotes keeps the notes that pass the checks, each with its line text,
// and says what was wrong with each of the others.
func CheckNotes(read Reader, in []Note) ([]Note, []string) {
	if len(in) == 0 || len(in) > maxNotes {
		return nil, []string{fmt.Sprintf("annotate takes 1 to %d notes", maxNotes)}
	}
	var ok []Note
	var errs []string
	for i, n := range in {
		if err := checkNote(read, &n); err != nil {
			errs = append(errs, fmt.Sprintf("notes[%d]: %s", i, err))
			continue
		}
		ok = append(ok, n)
	}
	return ok, errs
}

func checkNote(read Reader, n *Note) error {
	switch n.Kind {
	case "symbol", "line", "block":
	default:
		return errors.New("kind must be symbol, line or block")
	}
	n.Summary = cut(strings.TrimSpace(n.Summary), maxSummary)
	if n.Summary == "" {
		return errors.New("summary is empty")
	}
	n.Detail = cutBytes(strings.TrimSpace(n.Detail), maxBody)
	lines, ok := read(n.Path)
	if !ok {
		return fmt.Errorf("%s is not a file in the workspace", n.Path)
	}
	if n.Kind != "block" {
		n.L2 = n.L1 // a symbol or a line is shown on one line
	}
	if err := checkRange(lines, n.Path, n.L1, n.L2); err != nil {
		return err
	}
	if n.Kind == "symbol" {
		if n.Symbol == "" {
			return errors.New("symbol is empty")
		}
		line, err := findSymbol(lines, n.Path, n.Symbol, n.L1)
		if err != nil {
			return err
		}
		n.L1, n.L2 = line, line
	}
	n.Text = strings.Join(lines[n.L1-1:n.L2], "\n")
	return nil
}

// CheckWalkthrough checks every step. One bad step refuses the walkthrough.
func CheckWalkthrough(read Reader, w Walkthrough) (Walkthrough, error) {
	w.Title = cut(strings.TrimSpace(w.Title), maxSummary)
	if w.Title == "" {
		return w, errors.New("title is empty")
	}
	if len(w.Steps) < 2 || len(w.Steps) > maxSteps {
		return w, fmt.Errorf("a walkthrough has 2 to %d steps", maxSteps)
	}
	var errs []string
	for i := range w.Steps {
		s := &w.Steps[i]
		s.Title = cut(strings.TrimSpace(s.Title), maxSummary)
		s.Body = cutBytes(strings.TrimSpace(s.Body), maxBody)
		lines, ok := read(s.Path)
		var err error
		switch {
		case s.Title == "" || s.Body == "":
			err = errors.New("title and body are required")
		case !ok:
			err = fmt.Errorf("%s is not a file in the workspace", s.Path)
		default:
			err = checkRange(lines, s.Path, s.L1, s.L2)
		}
		if err != nil {
			errs = append(errs, fmt.Sprintf("step %d: %s", i+1, err))
			continue
		}
		s.Text = strings.Join(lines[s.L1-1:s.L2], "\n")
	}
	if len(errs) > 0 {
		return w, errors.New(strings.Join(errs, "; "))
	}
	return w, nil
}

func checkRange(lines []string, path string, l1, l2 int) error {
	where := fmt.Sprintf("%s:%d", path, l1)
	if l2 != l1 {
		where = fmt.Sprintf("%s:%d-%d", path, l1, l2)
	}
	switch {
	case l1 < 1 || l2 < l1:
		return fmt.Errorf("%s is not a range of lines", where)
	case l2 > len(lines):
		return fmt.Errorf("%s is past the end of the file (%d lines)", where, len(lines))
	}
	return nil
}

// findSymbol returns the line that has name as a whole word: line itself, the
// nearest within snapLines, or an error naming where it really is.
func findSymbol(lines []string, path, name string, line int) (int, error) {
	re := regexp.MustCompile(`(^|[^\p{L}\p{N}_$])` + regexp.QuoteMeta(name) + `($|[^\p{L}\p{N}_$])`)
	has := func(n int) bool { return n >= 1 && n <= len(lines) && re.MatchString(lines[n-1]) }
	for d := 0; d <= snapLines; d++ {
		if has(line - d) {
			return line - d, nil
		}
		if has(line + d) {
			return line + d, nil
		}
	}
	best := 0
	for n := 1; n <= len(lines); n++ {
		if has(n) && (best == 0 || abs(n-line) < abs(best-line)) {
			best = n
		}
	}
	if best == 0 {
		return 0, fmt.Errorf("%s is not in %s", name, path)
	}
	return 0, fmt.Errorf("%s is not on %s:%d; it is on line %d", name, path, line, best)
}

func cut(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func cutBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for len(s) > 0 && !utf8ValidEnd(s) {
		s = s[:len(s)-1]
	}
	return s
}

func utf8ValidEnd(s string) bool { return strings.ToValidUTF8(s, "") == s }

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
```

In `TestCheckNotes`, note 1 (`L1: 2`, `checkToken`) snaps to line 4 because line 3 is the comment `// checkToken reads the header.`, which also has the name: the nearest line wins and line 3 is tried first (`line + 1`). If the test's expectation of line 4 fails for that reason, change the fixture comment to `// reads the header.` instead of changing `findSymbol`.

- [ ] **Step 5: Implement `locate.go`**

```go
package notes

import "strings"

// Locate finds text in lines as they are now: the occurrence nearest the line
// it was saved at. ok is false when the text is gone.
func Locate(lines []string, text string, near int) (l1, l2 int, ok bool) {
	want := strings.Split(text, "\n")
	best := 0
	for i := 0; i+len(want) <= len(lines); i++ {
		match := true
		for j, w := range want {
			if lines[i+j] != w {
				match = false
				break
			}
		}
		if match && (best == 0 || abs(i+1-near) < abs(best-near)) {
			best = i + 1
		}
	}
	if best == 0 {
		return 0, 0, false
	}
	return best, best + len(want) - 1, true
}
```

- [ ] **Step 6: Run; expect PASS.** **Step 7: Commit** `git commit -m "Check notes and walkthroughs, and find them again"`

---

### Task 4: Tools, prompt, and tagged blocks

**Files:** Create `internal/explain/notes/tools.go`, `tagged.go`; Test `tools_test.go`, `tagged_test.go`

- [ ] **Step 1: Write the failing tests**

`tools_test.go`:

```go
package notes

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type rec struct {
	notes []Note
	walks []Walkthrough
	scope any
}

func (r *rec) AddNotes(scope any, n []Note)          { r.scope, r.notes = scope, append(r.notes, n...) }
func (r *rec) AddWalkthrough(scope any, w Walkthrough) { r.scope, r.walks = scope, append(r.walks, w) }

func TestApplyAnnotate(t *testing.T) {
	r := &rec{}
	args := `{"notes":[{"kind":"line","path":"auth.go","l1":4,"summary":"ok"},{"kind":"line","path":"auth.go","l1":99,"summary":"bad"}]}`
	text, err := Apply(read, r, "turn", "annotate", json.RawMessage(args))
	if err != nil || len(r.notes) != 1 || r.scope != "turn" {
		t.Fatalf("apply = %q %v %+v", text, err, r)
	}
	if !strings.HasPrefix(text, "Shown 1 of 2 notes.") || !strings.Contains(text, "notes[1]: auth.go:99 is past the end") {
		t.Fatalf("text = %q", text)
	}
	if _, err := Apply(read, r, "turn", "annotate", json.RawMessage(`{"notes":[{"kind":"line","path":"auth.go","l1":99,"summary":"bad"}]}`)); err == nil {
		t.Fatal("a call with no valid note must be an error")
	}
	if _, err := Apply(read, r, nil, "annotate", json.RawMessage(args)); err == nil {
		t.Fatal("a call without a turn must be refused")
	}
}

func TestApplyWalkthrough(t *testing.T) {
	r := &rec{}
	args := `{"title":"Login","steps":[{"path":"auth.go","l1":8,"l2":10,"title":"a","body":"b"},{"path":"auth.go","l1":4,"l2":6,"title":"c","body":"d"}]}`
	if text, err := Apply(read, r, "turn", "walkthrough", json.RawMessage(args)); err != nil || text != "Shown a walkthrough of 2 steps." || len(r.walks) != 1 {
		t.Fatalf("walkthrough = %q %v", text, err)
	}
}

func TestToolsServeBoth(t *testing.T) {
	tools := Tools(read, &rec{})
	if len(tools) != 2 || tools[0].Name != "annotate" || tools[1].Name != "walkthrough" || !json.Valid(tools[0].Schema) || !json.Valid(tools[1].Schema) {
		t.Fatalf("tools = %+v", tools)
	}
	if _, err := tools[0].Call(context.Background(), "turn", json.RawMessage(`{"notes":[{"kind":"line","path":"auth.go","l1":4,"summary":"ok"}]}`)); err != nil {
		t.Fatal(err)
	}
}
```

`tagged_test.go`:

```go
package notes

import (
	"encoding/json"
	"strings"
	"testing"
)

type textSink struct{ text, result strings.Builder }

func (s *textSink) Text(t string, _ bool) { s.text.WriteString(t) }
func (s *textSink) Step(string)           {}
func (s *textSink) Result(t string)       { s.result.WriteString(t) }

func TestTaggedPullsBlocksOutOfText(t *testing.T) {
	sink := &textSink{}
	var calls []string
	tg := NewTagged(sink, func(name string, args json.RawMessage) { calls = append(calls, name+" "+string(args)) })
	for _, chunk := range []string{"Here.\n<fa", "ah:annotate>{\"notes\":[]}</faah:ann", "otate>\nAnd <faah:walkthrough>{\"title\":\"x\"}</faah:walkthrough> done. a < b <faah:other>x</faah:other>"} {
		tg.Text(chunk, false)
	}
	tg.Flush()
	if got := sink.text.String(); got != "Here.\n\nAnd  done. a < b <faah:other>x</faah:other>" {
		t.Fatalf("text = %q", got)
	}
	if strings.Join(calls, "|") != `annotate {"notes":[]}|walkthrough {"title":"x"}` {
		t.Fatalf("calls = %v", calls)
	}
}

func TestTaggedFlushKeepsAnUnclosedBlock(t *testing.T) {
	sink := &textSink{}
	tg := NewTagged(sink, func(string, json.RawMessage) { t.Fatal("no call expected") })
	tg.Text("start <faah:annotate>{\"notes\"", false)
	tg.Flush()
	if got := sink.text.String(); got != "start <faah:annotate>{\"notes\"" {
		t.Fatalf("text = %q", got)
	}
}

func TestTaggedResult(t *testing.T) {
	sink := &textSink{}
	var n int
	tg := NewTagged(sink, func(string, json.RawMessage) { n++ })
	tg.Result("Done.\n<faah:annotate>{\"notes\":[]}</faah:annotate>")
	if n != 1 || strings.TrimSpace(sink.result.String()) != "Done." {
		t.Fatalf("result = %q, calls %d", sink.result.String(), n)
	}
}
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement `tools.go`**

```go
package notes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"faah/internal/agents"
	"faah/internal/mcp"
)

// Recorder receives what passed the checks, for the turn that called.
type Recorder interface {
	AddNotes(scope any, notes []Note)
	AddWalkthrough(scope any, w Walkthrough)
}

const annotateDesc = "Show explanations on the code in the reader's editor. One call takes a list of notes; " +
	"each explains one symbol, line, or block where it is. symbol and line notes are drawn on one line; " +
	"block notes cover l1 to l2. Notes that fail a check come back with the reason; send only those again."

const walkthroughDesc = "Guide the reader through a flow across functions or files, one step at a time. " +
	"Each step highlights lines l1 to l2 of a file with a short title and body. Use 2 to 20 steps, in reading order."

var annotateSchema = json.RawMessage(`{"type":"object","required":["notes"],"properties":{"notes":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"object","required":["kind","path","l1","summary"],"properties":{` +
	`"kind":{"type":"string","enum":["symbol","line","block"]},` +
	`"path":{"type":"string","description":"Workspace-relative file path"},` +
	`"l1":{"type":"integer","description":"First line, 1-based; for symbol and line, the line that holds it"},` +
	`"l2":{"type":"integer","description":"Last line of a block, inclusive"},` +
	`"symbol":{"type":"string","description":"The symbol's name, for kind symbol"},` +
	`"summary":{"type":"string","description":"One line, at most 120 characters, shown on the code"},` +
	`"detail":{"type":"string","description":"Optional Markdown shown on hover"}}}}}}`)

var walkthroughSchema = json.RawMessage(`{"type":"object","required":["title","steps"],"properties":{"title":{"type":"string"},"steps":{"type":"array","minItems":2,"maxItems":20,"items":{"type":"object","required":["path","l1","l2","title","body"],"properties":{` +
	`"path":{"type":"string"},"l1":{"type":"integer"},"l2":{"type":"integer"},"title":{"type":"string"},"body":{"type":"string"}}}}}}`)

// Apply runs one tool call: it checks the arguments, records what passed, and
// returns what to tell the agent. An error means nothing was shown.
func Apply(read Reader, rec Recorder, scope any, name string, args json.RawMessage) (string, error) {
	if scope == nil {
		return "", errors.New("no explanation is running")
	}
	switch name {
	case "annotate":
		var in struct {
			Notes []Note `json:"notes"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", fmt.Errorf("arguments: %v", err)
		}
		if in.Notes == nil { // a tagged block may hold one note on its own
			var one Note
			if json.Unmarshal(args, &one) == nil && one.Kind != "" {
				in.Notes = []Note{one}
			}
		}
		ok, errs := CheckNotes(read, in.Notes)
		if len(ok) == 0 {
			return "", errors.New(strings.Join(errs, "\n"))
		}
		rec.AddNotes(scope, ok)
		text := fmt.Sprintf("Shown %d of %d notes.", len(ok), len(in.Notes))
		if len(errs) > 0 {
			text += " Not shown:\n" + strings.Join(errs, "\n")
		}
		return text, nil
	case "walkthrough":
		var w Walkthrough
		if err := json.Unmarshal(args, &w); err != nil {
			return "", fmt.Errorf("arguments: %v", err)
		}
		w, err := CheckWalkthrough(read, w)
		if err != nil {
			return "", err
		}
		rec.AddWalkthrough(scope, w)
		return fmt.Sprintf("Shown a walkthrough of %d steps.", len(w.Steps)), nil
	}
	return "", fmt.Errorf("no tool named %s", name)
}

// Tools are annotate and walkthrough, for an mcp.Server.
func Tools(read Reader, rec Recorder) []mcp.Tool {
	call := func(name string) func(context.Context, any, json.RawMessage) (string, error) {
		return func(_ context.Context, scope any, args json.RawMessage) (string, error) {
			return Apply(read, rec, scope, name, args)
		}
	}
	return []mcp.Tool{
		{Name: "annotate", Description: annotateDesc, Schema: annotateSchema, ReadOnly: true, Call: call("annotate")},
		{Name: "walkthrough", Description: walkthroughDesc, Schema: walkthroughSchema, ReadOnly: true, Call: call("walkthrough")},
	}
}

// Prompt tells the agent how to show its explanation, for its tool channel.
func Prompt(ch agents.ToolChannel) string {
	const use = "Show your explanation on the code. Use annotate for code that can be explained where it is: " +
		"a symbol, a line, or a block; one call can carry many notes, up to a whole file. " +
		"Use walkthrough for behavior that spans several functions or files. Choose what fits the question. " +
		"Text you write outside the tools goes into the conversation beside the code, so keep it short.\n\n"
	switch ch {
	case agents.ToolsMCP:
		return "faah gives you two tools, annotate and walkthrough. " + use
	case agents.ToolsTagged:
		return "faah shows two kinds of tool call that you write in your reply, each on its own lines, " +
			"as one JSON object between tags. faah removes them from the text and draws them on the code.\n" +
			"<faah:annotate>{\"notes\":[{\"kind\":\"symbol|line|block\",\"path\":\"…\",\"l1\":0,\"l2\":0,\"symbol\":\"…\",\"summary\":\"…\",\"detail\":\"…\"}]}</faah:annotate>\n" +
			"<faah:walkthrough>{\"title\":\"…\",\"steps\":[{\"path\":\"…\",\"l1\":0,\"l2\":0,\"title\":\"…\",\"body\":\"…\"}]}</faah:walkthrough>\n" +
			"Paths are workspace-relative and lines 1-based. summary is one line of at most 120 characters. " + use
	}
	return ""
}
```

`internal/explain/notes` imports `internal/agents` for `ToolChannel` and `internal/mcp` for `Tool`; neither imports `notes`, so there is no cycle. `ToolChannel` is added in Task 5; until then this file does not build, so write Task 5 Step 3 (the `agents` types) first, then come back.

- [ ] **Step 4: Implement `tagged.go`**

```go
package notes

import (
	"encoding/json"
	"strings"

	"faah/internal/agents"
)

const openTag = "<faah:"

var tagNames = []string{"annotate", "walkthrough"}

// Tagged is a sink for a harness that writes its tool calls as tagged blocks
// in its reply. Text outside the blocks passes on as it arrives; text that may
// start a block is held until the block closes or turns out not to be one.
type Tagged struct {
	sink agents.Sink
	call func(name string, args json.RawMessage)
	held string
}

func NewTagged(sink agents.Sink, call func(name string, args json.RawMessage)) *Tagged {
	return &Tagged{sink: sink, call: call}
}

func (t *Tagged) Text(s string, block bool) {
	out := t.take(t.held + s)
	if out != "" {
		t.sink.Text(out, block)
	}
}

func (t *Tagged) Step(label string) { t.sink.Step(label) }

// Result is a whole final answer, so a block in it is complete or not at all.
func (t *Tagged) Result(s string) {
	out := t.take(s)
	t.sink.Result(out + t.held)
	t.held = ""
}

// Flush passes on text held for a block that never closed.
func (t *Tagged) Flush() {
	if t.held != "" {
		t.sink.Text(t.held, false)
		t.held = ""
	}
}

// take returns the text that can be passed on now, makes the calls for
// complete blocks, and keeps the rest in t.held.
func (t *Tagged) take(s string) string {
	var out strings.Builder
	t.held = ""
	for s != "" {
		i := strings.Index(s, openTag)
		if i < 0 {
			keep := partialOpen(s)
			out.WriteString(s[:len(s)-keep])
			t.held = s[len(s)-keep:]
			break
		}
		out.WriteString(s[:i])
		s = s[i:]
		name, ok := blockName(s)
		if !ok {
			if len(s) < len(openTag)+len("walkthrough>") && couldBeBlock(s) {
				t.held = s // too short to tell yet
				break
			}
			out.WriteString(openTag)
			s = s[len(openTag):]
			continue
		}
		start := len(openTag) + len(name) + 1
		end := strings.Index(s[start:], "</faah:"+name+">")
		if end < 0 {
			t.held = s // wait for the close
			break
		}
		t.call(name, json.RawMessage(strings.TrimSpace(s[start:start+end])))
		s = s[start+end+len("</faah:"+name+">"):]
	}
	return out.String()
}

func blockName(s string) (string, bool) {
	for _, n := range tagNames {
		if strings.HasPrefix(s, openTag+n+">") {
			return n, true
		}
	}
	return "", false
}

// couldBeBlock reports whether s, which starts with openTag, is the start of
// one of the known tags.
func couldBeBlock(s string) bool {
	for _, n := range tagNames {
		full := openTag + n + ">"
		if strings.HasPrefix(full, s) {
			return true
		}
	}
	return false
}

// partialOpen is how many bytes at the end of s could begin openTag.
func partialOpen(s string) int {
	for k := len(openTag) - 1; k > 0; k-- {
		if strings.HasSuffix(s, openTag[:k]) {
			return k
		}
	}
	return 0
}
```

- [ ] **Step 5: Run; expect PASS** (`go test ./internal/explain/notes/`). **Step 6: Commit** `git commit -m "Serve annotate and walkthrough as tools and as tagged blocks"`

---

### Task 5: Tool channels in agents

**Files:** Modify `internal/agents/agent.go`, `claude/claude.go`, `codex/codex.go`, `agy/agy.go`, `opencode/opencode.go`, `all/contract_test.go`, `claude/claude_test.go`

- [ ] **Step 1: Extend the contract test first**

Add `tools agents.ToolChannel` and `toolArgs string` to `expect`, and to the rows:

```go
	"claude": {…, tools: agents.ToolsMCP,
		toolArgs: `--mcp-config {"mcpServers":{"faah":{"headers":{"Authorization":"Bearer tok"},"type":"http","url":"http://127.0.0.1:1/api/mcp"}}} --strict-mcp-config --allowedTools mcp__faah__annotate,mcp__faah__walkthrough`},
	"codex": {…, tools: agents.ToolsMCP,
		toolArgs: `-c mcp_servers.faah.url="http://127.0.0.1:1/api/mcp" -c mcp_servers.faah.http_headers={Authorization="Bearer tok"}`},
	"agy":      {…, tools: agents.ToolsTagged},
	"opencode": {…, tools: agents.ToolsTagged},
```

and, after the follow-up check:

```go
			if a.Caps().Tools != want.tools {
				t.Fatalf("tools = %v, want %v", a.Caps().Tools, want.tools)
			}
			if want.toolArgs != "" {
				ep := &agents.ToolEndpoint{URL: "http://127.0.0.1:1/api/mcp", Token: "tok"}
				if _, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", SessionID: sid, Tools: ep, Timeout: 5 * time.Second}, &sink{}); err != nil {
					t.Fatal(err)
				}
				if got := rawArgs(dir); !strings.Contains(got, want.toolArgs) {
					t.Fatalf("tool args = %q, want %q", got, want.toolArgs)
				}
			}
```

`rawArgs` reads `args.txt` and joins its lines with single spaces without splitting inside an argument (the JSON has no spaces, so `strings.Join(lines, " ")` is enough). The `caps` comparison already in the test changes from `a.Caps() != want.caps` to comparing `Sessions` and `NamesSession` only, since `Tools` has its own check.

Change claude's `TestTurnArgv` calls from `TurnArgv(tpl, "U", false)` to `TurnArgv(agents.Turn{Argv: tpl, SessionID: "U"})` and `TurnArgv(agents.Turn{Argv: tpl, SessionID: "U", Resume: true})`.

- [ ] **Step 2: Run; expect FAIL** (undefined `ToolsMCP`).

- [ ] **Step 3: Add the types to `internal/agents/agent.go`**

```go
// ToolChannel is how an agent can call faah's tools.
type ToolChannel int

const (
	ToolsNone   ToolChannel = iota
	ToolsMCP                // MCP over HTTP, given in Turn.Tools
	ToolsTagged             // tagged blocks in the reply, see internal/explain/notes
)

// ToolEndpoint is where an MCP agent reaches faah's tools for one turn.
type ToolEndpoint struct {
	URL   string
	Token string
}
```

Add `Tools ToolChannel` to `Caps` with the comment `// how the agent can call faah's tools`, and `Tools *ToolEndpoint` to `Turn` with `// nil when the turn has no tools`. Change `Warmable`'s method to `TurnArgv(t Turn) []string`, documented as "the argv a turn runs: session and output flags when it has a session, tool flags when it has tools".

- [ ] **Step 4: claude**

```go
func (*Agent) Caps() agents.Caps {
	return agents.Caps{Sessions: true, Tools: agents.ToolsMCP}
}

func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, name, t, a.TurnArgv(t), parse, sink)
}

// TurnArgv adds the flags a turn needs right after the binary: output and
// session flags when the turn has a session, MCP flags when it has tools. A
// turn with neither runs its argv unchanged.
func (*Agent) TurnArgv(t agents.Turn) []string {
	var extra []string
	if t.SessionID != "" {
		extra = append(extra, "--output-format", "stream-json", "--verbose")
		if t.Resume {
			extra = append(extra, "--resume", t.SessionID)
		} else {
			extra = append(extra, "--session-id", t.SessionID)
		}
	}
	if t.Tools != nil {
		cfg, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"faah": map[string]any{
			"type": "http", "url": t.Tools.URL, "headers": map[string]string{"Authorization": "Bearer " + t.Tools.Token},
		}}})
		extra = append(extra, "--mcp-config", string(cfg), "--strict-mcp-config",
			"--allowedTools", "mcp__faah__annotate,mcp__faah__walkthrough")
	}
	if extra == nil {
		return t.Argv
	}
	return agents.InsertAfterBinary(t.Argv, extra)
}
```

`json.Marshal` sorts map keys, so the config is `{"mcpServers":{"faah":{"headers":…,"type":"http","url":…}}}`, which is what the contract row expects.

- [ ] **Step 5: agy** — `Caps{Sessions: true, NamesSession: true, Tools: agents.ToolsTagged}`; `TurnArgv(t agents.Turn)` keeps its body with `t.Argv`, `t.SessionID`, `t.Resume`; `Run` calls `a.TurnArgv(t)`.

- [ ] **Step 6: codex**

```go
func (*Agent) Caps() agents.Caps { return agents.Caps{Tools: agents.ToolsMCP} }

func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	argv := t.Argv
	if t.Tools != nil {
		argv = agents.InsertAfterBinary(argv, []string{
			"-c", fmt.Sprintf("mcp_servers.faah.url=%q", t.Tools.URL),
			"-c", fmt.Sprintf("mcp_servers.faah.http_headers={Authorization=%q}", "Bearer "+t.Tools.Token),
		})
	}
	return agents.Exec(ctx, name, t, argv, agents.PlainText, sink)
}
```

`-c` is a global codex option, so it may come before `exec`. Confirm with a real run: `codex -c 'mcp_servers.faah.url="http://127.0.0.1:9/x"' exec --skip-git-repo-check --sandbox read-only "say ok"` must not fail to parse its arguments (an MCP connection error is fine). If it does, insert after `argv[1]` when `argv[1] == "exec"` instead, and change the contract row to match.

- [ ] **Step 7: opencode** — `Caps{Tools: agents.ToolsTagged}`.

- [ ] **Step 8: Update the standby** — in `explain_standby.go`, `w.TurnArgv(ro, sessionID, false)` becomes `w.TurnArgv(agents.Turn{Argv: ro, SessionID: sessionID})` for now; Task 7 adds the token.

- [ ] **Step 9: Run** `go test ./internal/agents/... ./internal/explain/... && go test -run 'Standby|Explain|Thread' .`; **expect PASS**. **Commit** `git commit -m "Give each agent a tool channel"`

---

### Task 6: Prompt

**Files:** Modify `internal/explain/types.go` (`explainPromptVersion = 2`), `agent.go` (`threadPrompt`), `agent_test.go` and `explain_test.go` callers

- [ ] **Step 1: Write the failing test** in `explain_test.go`:

```go
func TestExplainPromptNamesTheTools(t *testing.T) {
	th := &thread{Kind: "explain", ExplainKind: explain.KindBlock}
	if p := threadPrompt(th, nil, "Explain main.go:1-2", false, "", false, agents.ToolsMCP); !strings.Contains(p, "two tools, annotate and walkthrough") {
		t.Fatalf("MCP prompt = %s", p)
	}
	if p := threadPrompt(th, nil, "Explain main.go:1-2", false, "", false, agents.ToolsTagged); !strings.Contains(p, "<faah:annotate>") {
		t.Fatalf("tagged prompt = %s", p)
	}
	if p := threadPrompt(th, nil, "Explain main.go:1-2", false, "", false, agents.ToolsNone); strings.Contains(p, "annotate") {
		t.Fatalf("no-tools prompt = %s", p)
	}
	if p := threadPrompt(&thread{}, nil, "hi", false, "", false, agents.ToolsMCP); strings.Contains(p, "annotate") {
		t.Fatal("only explanations are told about the tools")
	}
}
```

- [ ] **Step 2: Run; expect FAIL** (too many arguments).

- [ ] **Step 3: Implement** — add `tools agents.ToolChannel` as the last parameter of `threadPrompt`, and right after `b.WriteString(explain.Instructions(t.ExplainKind, t.ExplainReader))` write `b.WriteString(notes.Prompt(tools))`. In `runTurn`, pass `caps.Tools`. Update every other caller (`agent_test.go`'s `TestThreadPrompt`) to pass `agents.ToolsNone`. Set `explainPromptVersion = 2` in `internal/explain/types.go`; `TestExplainKeyAndHash` must still pass, since it compares keys made with the same version.

- [ ] **Step 4: Run; expect PASS. Commit** `git commit -m "Tell explanations about the tools"`

---

### Task 7: Tool calls reach the turn

**Files:** Create `explain_tools.go`; Modify `agent.go` (`threadTurn`, `threadManager`, `runTurn`), `explain_standby.go`, `server.go`, `main.go`; Test `explain_tools_test.go`

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mcpCall posts one tools/call to the server's MCP endpoint with a token.
func mcpCall(t *testing.T, s *Server, tok, name, args string) map[string]any {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
	r := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	var m map[string]any
	json.Unmarshal(w.Body.Bytes(), &m)
	return m
}

func TestExplainToolCallsLandOnTheTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	// The fake codex finds faah's endpoint and token in its -c flags and calls
	// annotate through curl, as a real harness would over MCP.
	script := `url=""; tok=""
for a in "$@"; do case "$a" in
mcp_servers.faah.url=*) url=${a#*=}; url=${url#\"}; url=${url%\"} ;;
mcp_servers.faah.http_headers=*) tok=${a#*Bearer }; tok=${tok%\"\}} ;;
esac; done
curl -s -H "Authorization: Bearer $tok" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"annotate","arguments":{"notes":[{"kind":"symbol","path":"main.go","l1":7,"symbol":"helper","summary":"Does nothing yet."}]}}}' "$url" > mcp-out.json
printf 'ok\n'`
	s := explainServer(t, root, script)
	ts := httptest.NewServer(s)
	defer ts.Close()
	s.SetToolsAddr(strings.TrimPrefix(ts.URL, "http://"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	if n := th.Turns[0].Notes; len(n) != 1 || n[0].Symbol != "helper" || n[0].L1 != 7 || n[0].Text != "func helper() {}" {
		out, _ := os.ReadFile(filepath.Join(root, "mcp-out.json"))
		t.Fatalf("notes = %+v (endpoint said %s)", n, out)
	}
	// The token stops working when the turn ends.
	if res := mcpCall(t, s, "anything", "annotate", `{"notes":[]}`); res["result"] != nil {
		t.Fatalf("a stranger's call was answered: %v", res)
	}
}

func TestExplainTaggedBlocksLandOnTheTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	verifyHarnesses(t, "opencode")
	p := filepath.Join(t.TempDir(), "opencode")
	body := "#!/bin/sh\nprintf '%s\\n' 'Helper.' '<faah:annotate>{\"notes\":[{\"kind\":\"line\",\"path\":\"main.go\",\"l1\":4,\"summary\":\"Calls helper.\"}]}</faah:annotate>'\n"
	if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	s := agentServer(t, root, p+" run {prompt}")
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	if strings.Contains(th.Turns[0].Reply, "faah:annotate") || len(th.Turns[0].Notes) != 1 {
		t.Fatalf("reply = %q, notes = %+v", th.Turns[0].Reply, th.Turns[0].Notes)
	}
}
```

If `agentServer` does not accept a plain command string with `{prompt}`, look at how `explainServer` builds its harness and copy that.

- [ ] **Step 2: Run; expect FAIL** (no `Notes` field, no `SetToolsAddr`).

- [ ] **Step 3: Turn fields** — in `threadTurn` add:

```go
	// What an explanation showed on the code through the explain tools.
	Notes        []notes.Note        `json:"notes,omitempty"`
	Walkthroughs []notes.Walkthrough `json:"walkthroughs,omitempty"`
```

- [ ] **Step 4: `explain_tools.go`**

```go
package main

import (
	"net"
	"net/http"

	"faah/internal/explain/notes"
	"faah/internal/mcp"
)

// toolScope is the turn a token acts for.
type toolScope struct {
	tid  string
	turn int
}

// explainTools serves annotate and walkthrough to explain turns over MCP.
type explainTools struct {
	tokens mcp.Tokens
	srv    *mcp.Server
	url    string // the MCP endpoint harnesses reach; "" until the server listens
}

func newExplainTools(tm *threadManager) *explainTools {
	et := &explainTools{}
	et.srv = &mcp.Server{Name: "faah", Version: version, Tokens: &et.tokens, Tools: notes.Tools(notes.DiskReader(tm.root), tm)}
	return et
}

// AddNotes records notes on the turn the scope names.
func (tm *threadManager) AddNotes(scope any, ns []notes.Note) {
	sc, ok := scope.(toolScope)
	if !ok {
		return
	}
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil {
		tr.Notes = append(tr.Notes, ns...)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[sc.tid])
	}
}

func (tm *threadManager) AddWalkthrough(scope any, w notes.Walkthrough) {
	sc, ok := scope.(toolScope)
	if !ok {
		return
	}
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tr := tm.turnLocked(sc); tr != nil {
		tr.Walkthroughs = append(tr.Walkthroughs, w)
		tm.saveLocked()
		tm.publishThreadLocked(tm.threads[sc.tid])
	}
}

func (tm *threadManager) turnLocked(sc toolScope) *threadTurn {
	t := tm.threads[sc.tid]
	if t == nil {
		return nil
	}
	for _, tr := range t.Turns {
		if tr.ID == sc.turn {
			return tr
		}
	}
	return nil
}

// SetToolsAddr tells explain turns where faah listens, as host:port. A
// server listening on every interface is reached on loopback.
func (s *Server) SetToolsAddr(addr string) {
	if s.threads == nil {
		return
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	s.threads.tools.url = "http://" + net.JoinHostPort(host, port) + s.routePath("/api/mcp")
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if s.threads == nil {
		http.Error(w, "threads need a coding harness", http.StatusNotFound)
		return
	}
	s.threads.tools.srv.ServeHTTP(w, r)
}
```

Check that `version` is the build version variable in `main.go`; if it is named differently, use that name. `SetToolsAddr` writes `url` once before any request is served, so it needs no lock.

- [ ] **Step 5: Wiring**
- `threadManager` gets `tools *explainTools`, set in `newThreadManager` with `tm.tools = newExplainTools(tm)`.
- `server.go`, next to `/api/explain`: `s.mux.HandleFunc(s.routePath("/api/mcp"), s.handleMCP)`.
- `main.go`, after `pxSrv.SetAgent(agent)`: `pxSrv.SetToolsAddr(addr)`.
- `standbyProc` gets `token string`. In `warmExplain`, when the agent's `Caps().Tools == agents.ToolsMCP` and `tm.tools.url != ""`, issue `tok := tm.tools.tokens.Issue(nil)` and start with `w.TurnArgv(agents.Turn{Argv: ro, SessionID: sessionID, Tools: &agents.ToolEndpoint{URL: tm.tools.url, Token: tok}})`. Store it on the standby; `kill` revokes it.
- `runTurn`, after the standby is taken and the session settled:

```go
	scope := toolScope{tid: r.tid, turn: r.turn.ID}
	var ep *agents.ToolEndpoint
	if explaining && caps.Tools == agents.ToolsMCP && tm.tools.url != "" {
		tok := ""
		if standby != nil && standby.token != "" {
			tok = standby.token
			tm.tools.tokens.Bind(tok, scope)
		} else {
			tok = tm.tools.tokens.Issue(scope)
		}
		defer tm.tools.tokens.Revoke(tok)
		ep = &agents.ToolEndpoint{URL: tm.tools.url, Token: tok}
	}
	var out agents.Sink = sink
	var tagged *notes.Tagged
	if explaining && caps.Tools == agents.ToolsTagged {
		read := notes.DiskReader(tm.root)
		tagged = notes.NewTagged(sink, func(name string, args json.RawMessage) {
			if _, err := notes.Apply(read, tm, scope, name, args); err != nil {
				ui.Status("err", "explain", r.tid+" "+name+": "+err.Error(), 0, os.Stdout)
			}
		})
		out = tagged
	}
```

  Pass `out` where `sink` was passed (both the standby `w.Stream(out)` and `a.Run(…, out)`), set `Tools: ep` on the `agents.Turn`, and after the run call `if tagged != nil { tagged.Flush() }`. The `var out agents.Outcome` already in `runTurn` must be renamed, for example to `res`, so the names do not clash.

- [ ] **Step 6: Run** `go test -run 'ExplainTool|ExplainTagged|Explain|Thread|Standby' .`; **expect PASS**. Then `go test ./...`. **Commit** `git commit -m "Record explain tool calls on the turn"`

---

### Task 8: Notes for a file, and staleness

**Files:** Modify `explain_tools.go`, `server.go`; Test `explain_tools_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestExplainNotesFollowTheCode(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := explainServer(t, root, `printf 'ok\n'`)
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	id := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	s.threads.AddNotes(toolScope{tid: id, turn: 1}, []notes.Note{
		{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "Calls helper.", Text: "\thelper()"},
		{Kind: "block", Path: "main.go", L1: 7, L2: 7, Summary: "Empty.", Text: "func helper() {}"},
	})

	get := func() []notes.View {
		var res struct{ Notes []notes.View }
		code, raw := agentGet(t, s, "/api/explain/notes?path=main.go")
		if code != 200 || json.Unmarshal(raw, &res) != nil {
			t.Fatalf("notes = %d %s", code, raw)
		}
		return res.Notes
	}
	if v := get(); len(v) != 2 || v[0].L1 != 4 || v[0].Stale != "" {
		t.Fatalf("notes = %+v", v)
	}
	// Two lines added above: both notes move. The block's text changes: outdated.
	writeExplainSource(t, root, "// a\n// b\n"+strings.Replace(explainGoSource, "func helper() {}", "func helper() { return }", 1))
	v := get()
	if v[0].L1 != 6 || v[0].Stale != "" || v[1].Stale != "text" || v[1].L1 != 7 {
		t.Fatalf("after edit = %+v", v)
	}
}
```

If there is no `agentGet` helper, add one next to `agentPostJSON` in `agent_test.go` that sends a GET through `s.ServeHTTP` and returns the code and body.

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement** in `explain_tools.go`. Add to `notes.go` in the notes package:

```go
// View is a saved note as the editor shows it now.
type View struct {
	Thread string `json:"thread"`
	Turn   int    `json:"turn"`
	Index  int    `json:"index"`
	Note
	Stale string `json:"stale,omitempty"` // "", "text" (its code changed), or "refs" (a symbol's uses changed)
}
```

and in `explain_tools.go`:

```go
// FileNotes is every saved note on rel, newest first wins for the same code,
// found again in the file as it is now.
func (tm *threadManager) FileNotes(rel string, lines []string) []notes.View {
	tm.mu.Lock()
	var views []notes.View
	seen := map[string]bool{}
	ts := make([]*thread, 0, len(tm.threads))
	for _, t := range tm.threads {
		if t.Kind == "explain" {
			ts = append(ts, t)
		}
	}
	sort.Slice(ts, func(i, j int) bool { return ts[i].Updated > ts[j].Updated })
	for _, t := range ts {
		for k := len(t.Turns) - 1; k >= 0; k-- {
			tr := t.Turns[k]
			for i := len(tr.Notes) - 1; i >= 0; i-- {
				n := tr.Notes[i]
				if n.Path != rel || seen[n.Kind+"\x00"+n.Text] {
					continue
				}
				seen[n.Kind+"\x00"+n.Text] = true
				views = append(views, notes.View{Thread: t.ID, Turn: tr.ID, Index: i, Note: n})
			}
		}
	}
	tm.mu.Unlock()
	for i := range views {
		v := &views[i]
		if l1, l2, ok := notes.Locate(lines, v.Text, v.L1); ok {
			v.L1, v.L2 = l1, l2
		} else {
			v.Stale = "text"
		}
	}
	sort.Slice(views, func(i, j int) bool { return views[i].L1 < views[j].L1 })
	return views
}

func (s *Server) handleExplainNotes(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	rel := r.URL.Query().Get("path")
	abs, _, ok := s.safePath(rel)
	if !ok {
		fail(w, http.StatusBadRequest, "bad path")
		return
	}
	lines, err := explain.ReadLines(abs)
	if err != nil {
		fail(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, map[string]any{"notes": s.threads.FileNotes(rel, lines)})
}
```

Register `s.mux.HandleFunc(s.routePath("/api/explain/notes"), s.handleExplainNotes)`. Use the JSON writer and the `fail` helper `server.go` already has; if `writeJSON` is named differently there, use that name.

- [ ] **Step 4: Run; expect PASS. Commit** `git commit -m "Serve the notes on a file, found again in moved code"`

---

### Task 9: A symbol note is outdated when its uses change

**Files:** Modify `explain_tools.go`; Test `explain_tools_test.go`

- [ ] **Step 1: Write the failing test**

```go
func TestExplainSymbolNoteNoticesNewUses(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := explainServer(t, root, `printf 'ok\n'`)
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	id := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	s.threads.AddNotes(toolScope{tid: id, turn: 1}, []notes.Note{{Kind: "symbol", Path: "main.go", L1: 7, L2: 7, Symbol: "helper", Summary: "Empty.", Text: "func helper() {}"}})
	waitFor(t, func() bool { return s.threads.Get(id).Turns[0].Notes[0].Refs != "" }) // hash taken in the background
	// A new caller, in another file: the note stays put but is outdated.
	os.WriteFile(filepath.Join(root, "other.go"), []byte("package main\n\nfunc other() { helper() }\n"), 0o644)
	s.ix.Build()
	waitFor(t, func() bool {
		_, raw := agentGet(t, s, "/api/explain/notes?path=main.go")
		return strings.Contains(string(raw), `"stale":"refs"`)
	})
}
```

`waitFor` polls up to 5 seconds; add it next to `waitThreadIdle` if it does not exist. The test server has no language server, so the hash comes from the text search, as in `TestGatherExplainFallsBackToText`. If `s.ix.Build()` is not how the index refreshes in tests, use what other search tests use.

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement**
- `symbolHash(n notes.Note) string` on `*Server`: read the file, find `n.Symbol` on `n.L1` (the line comes from `Locate`), build `explain.Target{Abs, Rel, L1: line, L2: line, Col: explain.UTF16Len(text[:idx]), Name: n.Symbol, Text: n.Symbol}`, and return `explain.Gather(ctx, explainWorkspace{s.lsp, s}, target, lines).Hash` with a context bounded by `explain.Budget`.
- `AddNotes` cannot reach the `Server`, so `threadManager` gets a `symbolHash func(notes.Note) string` field that `SetAgent` (where the server creates `s.threads`) sets to `s.symbolHash`. After `AddNotes` saves, for each symbol note it starts a goroutine that computes the hash and stores it in the note's `Refs` under the lock, then saves.
- `FileNotes` gets a `refsCache map[string]string` on `threadManager`, keyed by note key plus the file's modification time, and a set of keys in flight. For a symbol note that is not text-stale and has `Refs`: a cached hash that differs from `Refs` sets `Stale = "refs"`, using `explain.StaleReason(n.Refs, cached) != ""` so that a side that was not gathered says nothing. With no cached hash, it starts one background computation for that key and leaves the note as it is.
- Use the other file's modification time as well? No: a new caller elsewhere does not change `main.go`. Key the cache by the note and a counter that `handleExplainNotes` does not control: the index's generation if `Index` exposes one, otherwise a 30-second time bucket. Check `index.go` for a generation or version counter first.

- [ ] **Step 4: Run; expect PASS. Run** `go test -race -run 'ExplainSymbolNote|ExplainNotes|ExplainTool' .` **Commit** `git commit -m "Mark a symbol note outdated when its uses change"`

---

### Task 10: List notes and walkthroughs in the thread

**Files:** Modify `web/src/thread.js` (`thrTurnHtml`), `web/style.css`

- [ ] **Step 1: Render** — in `thrTurnHtml`, after the reply and before the error:

```js
  if (turn.notes && turn.notes.length) {
    h += '<div class="thr-notes"><div class="thr-notes-head">' + turn.notes.length + (turn.notes.length === 1 ? ' note' : ' notes') + ' on the code</div>' +
      turn.notes.map(n => '<a href="#" class="thr-link thr-note" data-path="' + esc(n.path) + '" data-line="' + n.l1 + '"' + (n.l2 > n.l1 ? ' data-end="' + n.l2 + '"' : '') + '>' +
        '<span class="thr-note-where">' + esc(n.path) + ':' + n.l1 + (n.l2 > n.l1 ? '-' + n.l2 : '') + '</span> ' + esc(n.summary) + '</a>').join('') + '</div>';
  }
  for (const w of turn.walkthroughs || []) {
    h += '<div class="thr-notes thr-walk"><div class="thr-notes-head">Walkthrough: ' + esc(w.title) + '</div><ol>' +
      w.steps.map(s => '<li><a href="#" class="thr-link" data-path="' + esc(s.path) + '" data-line="' + s.l1 + '" data-end="' + s.l2 + '">' + esc(s.title) + '</a> ' + esc(s.body) + '</li>').join('') + '</ol></div>';
  }
```

The existing click handler for `a.thr-link` opens the file and highlights the range.

- [ ] **Step 2: Style** — add to `web/style.css` near the other `.thr-` rules, using the theme tokens those rules use:

```css
.thr-notes { margin: 8px 0 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; }
.thr-notes-head { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.thr-note { display: block; padding: 2px 0; text-decoration: none; color: inherit; }
.thr-note-where { color: var(--muted); font-family: var(--mono); font-size: 11px; }
.thr-walk ol { margin: 0; padding-left: 18px; }
```

If those variable names do not exist, use the ones `.thr-changed` uses.

- [ ] **Step 3: Check** `npm run -s check && npm run -s build`; **expect** both pass. **Commit** `git commit -m "List notes and walkthroughs under an explanation"`

---

### Task 11: Real harnesses, docs, review, pull request

- [ ] **Step 1: Conformance** — in `explain_conformance_test.go` (build tag `harness`), after the explanation finishes, require `len(th.Turns[0].Notes) > 0 || len(th.Turns[0].Walkthroughs) > 0`, and serve the test server on a real listener (`httptest.NewServer(s)` plus `s.SetToolsAddr`) so MCP harnesses can reach it. Run for claude (haiku), codex, opencode (`opencode-go/claude-haiku-5-5`), and agy: `FAAH_CONFORMANCE=claude,codex,opencode,agy go test -tags harness -run TestExplainHarnessConformance -v .`, using the same variables the test reads today. Record what each produced in the PR body. A harness that answers in prose only is a finding to report, not a failure to hide.
- [ ] **Step 2: Docs** — `docs/internals/threads.md` section 6c: a **Tools** bullet (the endpoint, tokens bound per turn, the warm-up's unbound token, tagged blocks for opencode and agy, what each tool returns) and a **Notes** bullet (`GET /api/explain/notes`, `Locate`, `Stale` values). `docs/features/threads.md`: one sentence that explanations list their notes and walkthroughs under the reply, with links to the code. Spec: mark phase 1 done.
- [ ] **Step 3: Full verification** — `go test -count=1 ./... && npm run -s check && npm run -s build && GOOS=windows go build ./... && go vet -tags harness ./...`, and `-race` on the explain, thread, standby, mcp, and notes tests.
- [ ] **Step 4: Review** — a Codex review (`gpt-6.1-sol`, high) of the branch against `main`: token handling and the endpoint's exposure, the tagged reader on split chunks, check messages, lock use in `AddNotes`/`FileNotes`, and the standby token. Fix what it finds.
- [ ] **Step 5: Pull request** — push `explain-tools`, open a PR to `main` with no attribution lines, and link it.
