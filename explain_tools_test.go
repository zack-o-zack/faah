package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
	"faah/internal/explain"
	"faah/internal/explain/notes"
)

// mcpCall posts one tools/call to the server's MCP endpoint with a token and
// returns the HTTP status.
func mcpCall(t *testing.T, s *Server, tok, name, args string) int {
	t.Helper()
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+tok)
	headers.Set("Content-Type", "application/json")
	headers.Set("Accept", "application/json, text/event-stream")
	init := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"id":0,"method":"initialize"}`))
	init.Header = headers.Clone()
	iw := httptest.NewRecorder()
	s.ServeHTTP(iw, init)
	r := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(body))
	r.Header = headers.Clone()
	r.Header.Set("Mcp-Session-Id", iw.Header().Get("Mcp-Session-Id"))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code == 200 && !strings.Contains(w.Body.String(), "no explanation is running") {
		t.Fatalf("idle call: %s", w.Body)
	}

	return w.Code
}

func TestExplainToolCallsLandOnTheTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	// The fake agent calls annotate through its registered MCP endpoint.
	s := fakeAgentServer(t, root, func(ctx context.Context, o agents.Open, _ string, sink agents.Sink) error {
		if o.Tools == nil {
			return fmt.Errorf("missing MCP endpoint")
		}
		sink.Text("tok="+strings.TrimPrefix(o.Tools.Authorization, "Bearer ")+"\n", false)
		call := func(body, sid string) (string, error) {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.Tools.URL, strings.NewReader(body))
			if err != nil {
				return "", err
			}
			req.Header.Set("Authorization", o.Tools.Authorization)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json, text/event-stream")
			if sid != "" {
				req.Header.Set("Mcp-Session-Id", sid)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return "", err
			}
			defer resp.Body.Close()
			data, err := io.ReadAll(resp.Body)
			sink.Text(string(data), false)
			if resp.StatusCode != http.StatusOK {
				return "", fmt.Errorf("MCP HTTP %d: %s", resp.StatusCode, data)
			}
			return resp.Header.Get("Mcp-Session-Id"), err
		}
		sid, err := call(`{"id":0,"method":"initialize"}`, "")
		if err != nil {
			return err
		}
		_, err = call(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"annotate","arguments":{"notes":[{"kind":"symbol","path":"main.go","l1":7,"symbol":"helper","summary":"Does nothing yet."}]}}}`, sid)
		return err
	})
	ts := httptest.NewServer(s)
	defer ts.Close()
	s.SetToolsAddr(strings.TrimPrefix(ts.URL, "http://"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	tr := th.Turns[0]
	if n := tr.Notes; len(n) != 1 || n[0].Symbol != "helper" || n[0].L1 != 7 || n[0].Text != "func helper() {}" {
		t.Fatalf("notes = %+v\nreply: %s\nerror: %s", n, tr.Reply, tr.Error)
	}
	// The session credential remains valid between turns; tools refuse idle calls.
	tok := regexp.MustCompile(`tok=([A-Za-z0-9_-]+)`).FindStringSubmatch(tr.Reply)
	if tok == nil {
		t.Fatalf("no token in %q", tr.Reply)
	}
	if code := mcpCall(t, s, tok[1], "annotate", `{"notes":[]}`); code != http.StatusOK {
		t.Fatalf("after the turn, a call = %d", code)
	}
}

func agentGet(t *testing.T, s *Server, url string) (int, []byte) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec.Code, rec.Body.Bytes()
}

func fileNotes(t *testing.T, s *Server, rel string) []notes.View {
	t.Helper()
	var res struct{ Notes []notes.View }
	code, raw := agentGet(t, s, "/api/explain/notes?path="+rel)
	if code != 200 || json.Unmarshal(raw, &res) != nil {
		t.Fatalf("notes = %d %s", code, raw)
	}
	return res.Notes
}

func TestExplainNotesFollowTheCode(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	id := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	saveNotes(s, toolScope{tid: id, turn: 1}, []notes.Note{
		{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "Calls helper.", Text: "\thelper()"},
		{Kind: "block", Path: "main.go", L1: 7, L2: 7, Summary: "Empty.", Text: "func helper() {}"},
		{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "Calls helper, newer.", Text: "\thelper()"},
	})

	if v := fileNotes(t, s, "main.go"); len(v) != 2 || v[0].L1 != 4 || v[0].Summary != "Calls helper, newer." || v[0].Stale != "" || v[1].L1 != 7 {
		t.Fatalf("notes = %+v", v)
	}
	// Two lines added above: both notes move. The block's text changes: outdated.
	writeExplainSource(t, root, "// a\n// b\n"+strings.Replace(explainGoSource, "func helper() {}", "func helper() { return }", 1))
	if v := fileNotes(t, s, "main.go"); len(v) != 2 || v[0].L1 != 6 || v[0].Stale != "" || v[1].Stale != "text" || v[1].L1 != 7 {
		t.Fatalf("after edit = %+v", v)
	}
	if code, _ := agentGet(t, s, "/api/explain/notes?path=../x"); code != http.StatusBadRequest {
		t.Fatalf("outside path = %d", code)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestExplainSymbolNoteNoticesNewUses(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	id := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	saveNotes(s, toolScope{tid: id, turn: 1}, []notes.Note{{Kind: "symbol", Path: "main.go", L1: 7, L2: 7, Symbol: "helper", Summary: "Empty.", Text: "func helper() {}"}})
	waitFor(t, func() bool { return s.threads.Get(id).Turns[0].Notes[0].Refs != "" })
	fresh := refsFresh
	refsFresh = 0
	t.Cleanup(func() { refsFresh = fresh })
	if v := fileNotes(t, s, "main.go"); len(v) != 1 || v[0].Stale != "" {
		t.Fatalf("before = %+v", v)
	}
	// A new caller in another file: the note stays put but is outdated.
	os.WriteFile(filepath.Join(root, "other.go"), []byte("package main\n\nfunc other() { helper() }\n"), 0o644)
	s.ix.Build()
	waitFor(t, func() bool {
		v := fileNotes(t, s, "main.go")
		return len(v) == 1 && v[0].Stale == "refs" && v[0].L1 == 7
	})
}

// saveNotes adds notes to a turn that has ended, as the tools did while it ran.
func saveNotes(s *Server, sc toolScope, ns []notes.Note) {
	tm := s.threads
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.saveNotesLocked(sc, tm.turnLocked(sc), ns)
}

func TestExplainToolsRefuseAnEndedTurn(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	_, m := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	id := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, id)
	sc := toolScope{tid: id, turn: 1}
	s.threads.AddNotes(sc, []notes.Note{{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "late", Text: "\thelper()"}})
	s.threads.AddWalkthrough(sc, notes.Walkthrough{Title: "late"})
	if tr := s.threads.Get(id).Turns[0]; len(tr.Notes) != 0 || len(tr.Walkthroughs) != 0 {
		t.Fatalf("an ended turn took %+v %+v", tr.Notes, tr.Walkthroughs)
	}
}

func TestExplainReplayCarriesWhatWasShown(t *testing.T) {
	th := &thread{Kind: "explain", ExplainKind: explain.KindBlock}
	prior := []*threadTurn{{Prompt: "Explain", Reply: "See the notes.",
		Notes:        []notes.Note{{Kind: "line", Path: "main.go", L1: 4, L2: 4, Summary: "Calls helper."}},
		Walkthroughs: []notes.Walkthrough{{Title: "Flow", Steps: []notes.Step{{Path: "main.go", L1: 3, L2: 5, Title: "Main", Body: "Starts."}, {Path: "main.go", L1: 7, L2: 7, Title: "Helper", Body: "Ends."}}}},
	}}
	p := threadPrompt(th, prior, "expand step 2", true, "", false)
	for _, want := range []string{"- line main.go:4: Calls helper.", `(walkthrough shown, "Flow":`, "2. main.go:7 Helper: Ends."} {
		if !strings.Contains(p, want) {
			t.Fatalf("replay lacks %q:\n%s", want, p)
		}
	}
}
