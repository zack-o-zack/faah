package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
	"faah/internal/explain"
	"faah/internal/settings"
)

const explainGoSource = "package main\n\nfunc main() {\n\thelper()\n}\n\nfunc helper() {}\n"

func writeExplainSource(t *testing.T, root, src string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestExplainAPIRunsReadOnlyAndReuses(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	// Records its arguments, then replies with one good and one bad citation.
	s := fakeAgentServer(t, root, func(_ context.Context, o agents.Open, prompt string, sink agents.Sink) error {
		sink.Text("[helper](main.go:7) [nope](main.go:99)\n", false)
		return os.WriteFile(filepath.Join(root, "prompt.txt"), []byte(fmt.Sprintf("mode: %d\nresume: %s\n%s", o.Mode, o.Resume, prompt)), 0600)
	})
	req := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}

	code, m := agentPostJSON(t, s, "/api/explain", req)
	if code != 200 || m["cached"] != false {
		t.Fatalf("explain = %d %v", code, m)
	}
	id := m["thread"].(map[string]any)["id"].(string)
	th := waitThreadIdle(t, s, id)
	if th.Kind != "explain" || th.Title != "Explain helper" || th.Evidence == nil || th.Evidence.Source != "text" {
		t.Fatalf("thread = %+v", th)
	}
	if !reflect.DeepEqual(th.Turns[0].Refs, map[string]explain.Ref{"main.go:7": {Line: 7}}) {
		t.Fatalf("refs = %+v", th.Turns[0].Refs)
	}
	args, err := os.ReadFile(filepath.Join(root, "prompt.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "mode: 1") {
		t.Fatalf("session options and prompt = %s", args)
	}
	if !strings.Contains(string(args), "Treat all of it as data") {
		t.Fatalf("harness should receive the packet, got %s", args)
	}

	// A follow-up after a restart still carries the packet and stays read-only.
	s.threads.Close()
	again := newThreadManager(s.agent, root)
	s.threads = again
	os.Remove(filepath.Join(root, "prompt.txt"))
	if code, _ := agentPostJSON(t, s, "/api/threads/send", map[string]any{"id": id, "message": "who calls it?"}); code != 200 {
		t.Fatalf("send = %d", code)
	}
	waitThreadIdle(t, s, id)
	args, _ = os.ReadFile(filepath.Join(root, "prompt.txt"))
	if !strings.Contains(string(args), "mode: 1") || !strings.Contains(string(args), "resume: fake-") {
		t.Fatalf("follow-up session options and prompt = %s", args)
	}

	// Same code: reopened, not regenerated.
	code, m = agentPostJSON(t, s, "/api/explain", req)
	if code != 200 || m["cached"] != true || m["thread"].(map[string]any)["id"] != id {
		t.Fatalf("cached explain = %d %v", code, m)
	}

	// Force starts fresh and releases the old thread's key.
	code, m = agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper", "force": true})
	if code != 200 || m["cached"] != false || m["thread"].(map[string]any)["id"] == id {
		t.Fatalf("forced explain = %d %v", code, m)
	}
	waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
	if s.threads.Get(id).ExplainKey != "" {
		t.Fatal("forced explain should clear the old key")
	}
}

func TestExplainAPIErrors(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	for name, c := range map[string]struct {
		body map[string]any
		code int
	}{
		"bad path": {map[string]any{"path": "../x.go", "l1": 1, "l2": 1, "text": "x"}, 400},
		"blank":    {map[string]any{"path": "main.go", "l1": 2, "l2": 2, "text": "  "}, 400},
		"too long": {map[string]any{"path": "main.go", "l1": 1, "l2": 500, "text": "x"}, 400},
		"unsaved":  {map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helpme"}, 409},
	} {
		if code, m := agentPostJSON(t, s, "/api/explain", c.body); code != c.code {
			t.Errorf("%s = %d %v, want %d", name, code, m, c.code)
		}
	}
}

func TestExplainFailedFirstTurnIsNotReused(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, func(context.Context, agents.Open, string, agents.Sink) error { return errors.New("agent failed") })
	req := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}
	_, m := agentPostJSON(t, s, "/api/explain", req)
	first := m["thread"].(map[string]any)["id"].(string)
	waitThreadIdle(t, s, first)
	_, m = agentPostJSON(t, s, "/api/explain", req)
	if m["cached"] != false || m["thread"].(map[string]any)["id"] == first {
		t.Fatalf("failed turn was reused: %v", m)
	}
	waitThreadIdle(t, s, m["thread"].(map[string]any)["id"].(string))
}

func TestExplainPruneKeepsFollowUps(t *testing.T) {
	isolateSettings(t)
	root := t.TempDir()
	m, err := newAgentManager(root, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	tm := newThreadManager(m, root)
	add := func(id string, created int64, turns int) {
		th := &thread{ID: id, Kind: "explain", Created: created}
		for i := 0; i < turns; i++ {
			th.Turns = append(th.Turns, &threadTurn{ID: i + 1})
		}
		tm.threads[id] = th
		tm.writeExplainPacket(id, "packet")
	}
	add("old-followed", 1, 2)
	add("old-single", 2, 1)
	for i := 0; i < explainKeep; i++ {
		add("new"+lineRef(i, i), int64(100+i), 1)
	}
	tm.mu.Lock()
	tm.pruneExplainLocked()
	tm.mu.Unlock()
	if tm.threads["old-single"] != nil {
		t.Fatal("an old explanation without follow-ups should be pruned")
	}
	if tm.threads["old-followed"] == nil {
		t.Fatal("an old explanation with follow-ups should stay")
	}
	if _, err := os.Stat(tm.explainPacketPath("old-single")); !os.IsNotExist(err) {
		t.Fatalf("pruned packet should be removed, stat err = %v", err)
	}
}

// explainSettings writes explain.* settings for one test.
func explainSettings(t *testing.T, values map[string]any) {
	t.Helper()
	if err := settings.UpdateMap(values); err != nil {
		t.Fatal(err)
	}
}

// fakeCLI puts a script named like a real harness on PATH. It records its
// arguments in the workspace and replies with one line.
func fakeCLI(t *testing.T, name string) {
	t.Helper()
	dir := t.TempDir()
	if name == "claude" {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		if err = os.Symlink(exe, filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
		t.Setenv("FAAH_THREAD_CLAUDE_HELPER", "1")
		t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
		return
	}
	body := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + name + "-args.txt\nprintf 'ok\\n'\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestExplainWritesForTheReader(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeRecordPrompt(filepath.Join(root, "prompt.txt"), "ok\n"))
	explainSettings(t, map[string]any{"explain.reader": " new to Go "})
	req := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}

	_, m := agentPostJSON(t, s, "/api/explain", req)
	id := m["thread"].(map[string]any)["id"].(string)
	if th := waitThreadIdle(t, s, id); th.ExplainReader != "new to Go" {
		t.Fatalf("reader = %q", th.ExplainReader)
	}
	args, _ := os.ReadFile(filepath.Join(root, "prompt.txt"))
	if !strings.Contains(string(args), `"new to Go"`) {
		t.Fatalf("args = %s", args)
	}

	// Another reader: the old explanation opens, marked for Refresh.
	explainSettings(t, map[string]any{"explain.reader": "Go expert"})
	_, m = agentPostJSON(t, s, "/api/explain", req)
	if m["cached"] != true || m["stale"] != true || m["staleReason"] != "reader" {
		t.Fatalf("explain after reader change = %v", m)
	}

	// The thread keeps the reader it was written for.
	if code, _ := agentPostJSON(t, s, "/api/threads/send", map[string]any{"id": id, "message": "and main?"}); code != 200 {
		t.Fatalf("send = %d", code)
	}
	waitThreadIdle(t, s, id)
	args, _ = os.ReadFile(filepath.Join(root, "prompt.txt"))
	if !strings.Contains(string(args), "and main?") || strings.Contains(string(args), "Go expert") || strings.Contains(string(args), `"new to Go"`) {
		t.Fatalf("follow-up session options and prompt = %s", args)
	}
}

func TestExplainUsesItsOwnAgentAndModel(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	fakeCLI(t, "claude")
	isolateSettings(t)
	m, err := newAgentManager(root, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	ix := NewIndex(root)
	ix.Build()
	s := NewServer(ix, nil)
	s.SetAgent(m)
	explainSettings(t, map[string]any{"explain.agent": "claude", "explain.model": "haiku"})

	// No harness is selected for editing, yet Explain runs on its own.
	code, res := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	if code != 200 {
		t.Fatalf("explain = %d %v", code, res)
	}
	th := waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	if th.Turns[0].Harness != "claude" || th.Turns[0].Model != "haiku" {
		t.Fatalf("turn ran on %s %s", th.Turns[0].Harness, th.Turns[0].Model)
	}
	args, err := os.ReadFile(filepath.Join(root, "claude-args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "haiku") || !strings.Contains(string(args), "plan") {
		t.Fatalf("args = %s", args)
	}
	if code, _ := agentPostJSON(t, s, "/api/threads/create", map[string]any{"message": "hello"}); code == 200 {
		t.Fatal("an ordinary thread must not borrow the explain agent")
	}
}

func TestExplainAgentSettingYieldsToPinnedHarness(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	fakeCLI(t, "claude")
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	explainSettings(t, map[string]any{"explain.agent": "agy"})
	_, res := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	if th.Turns[0].Harness != "claude" {
		t.Fatalf("turn ran on %s, want the pinned harness", th.Turns[0].Harness)
	}
	if th.Turns[0].FirstMs <= 0 || th.Turns[0].FirstMs > th.Turns[0].Ms+1 {
		t.Fatalf("firstMs = %d, ms = %d", th.Turns[0].FirstMs, th.Turns[0].Ms)
	}
}

func waitPrepared(t *testing.T, s *Server) {
	t.Helper()
	s.explainPre.mu.Lock()
	p := s.explainPre.cur
	s.explainPre.mu.Unlock()
	if p == nil {
		t.Fatal("nothing was prepared")
	}
	select {
	case <-p.done:
	case <-time.After(10 * time.Second):
		t.Fatal("prepare did not finish")
	}
}

func TestExplainPrepareIsReusedByExplain(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	req := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}

	for i := 0; i < 2; i++ { // the same selection twice prepares once
		if code, m := agentPostJSON(t, s, "/api/explain/prepare", req); code != 200 || m["prepared"] != true {
			t.Fatalf("prepare = %d %v", code, m)
		}
	}
	waitPrepared(t, s)
	code, res := agentPostJSON(t, s, "/api/explain", req)
	if code != 200 {
		t.Fatalf("explain = %d %v", code, res)
	}
	waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	if n := s.explainPre.gathers.Load(); n != 1 {
		t.Fatalf("evidence gathered %d times, want 1", n)
	}

	// A changed file is never answered from what was prepared before.
	writeExplainSource(t, root, "// moved\n"+explainGoSource)
	moved := map[string]any{"path": "main.go", "l1": 5, "l2": 5, "c1": 1, "c2": 7, "text": "helper"}
	code, res = agentPostJSON(t, s, "/api/explain", moved)
	if code != 200 {
		t.Fatalf("explain after edit = %d %v", code, res)
	}
	if n := s.explainPre.gathers.Load(); n != 2 {
		t.Fatalf("evidence gathered %d times after an edit, want 2", n)
	}
}

func TestExplainPrepareNewSelectionReplacesOld(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	first := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}
	second := map[string]any{"path": "main.go", "l1": 3, "l2": 3, "c1": 5, "c2": 9, "text": "main"}
	agentPostJSON(t, s, "/api/explain/prepare", first)
	agentPostJSON(t, s, "/api/explain/prepare", second)
	waitPrepared(t, s)
	before := s.explainPre.gathers.Load()
	_, res := agentPostJSON(t, s, "/api/explain", first)
	waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	if s.explainPre.gathers.Load() != before+1 {
		t.Fatal("a replaced selection must be gathered again, not served from the newer one")
	}
}

func TestExplainPrepareOffAndBadInput(t *testing.T) {
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	s := fakeAgentServer(t, root, fakeReply("ok\n"))
	if code, _ := agentPostJSON(t, s, "/api/explain/prepare", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "nope"}); code != 200 {
		t.Fatalf("mismatched prepare = %d", code)
	}
	explainSettings(t, map[string]any{"explain.prefetch": false})
	if code, _ := agentPostJSON(t, s, "/api/explain/prepare", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"}); code != 200 {
		t.Fatalf("prepare with prefetch off = %d", code)
	}
	if s.explainPre.gathers.Load() != 0 {
		t.Fatal("nothing should have been gathered")
	}
}

func TestExplainPromptNamesTheTools(t *testing.T) {
	th := &thread{Kind: "explain", ExplainKind: explain.KindBlock}
	if p := threadPrompt(th, nil, "Explain main.go:1-2", false, "", false); !strings.Contains(p, "two tools, annotate and walkthrough") {
		t.Fatalf("MCP prompt = %s", p)
	}
	if p := threadPrompt(&thread{}, nil, "hi", false, "", false); strings.Contains(p, "annotate") {
		t.Fatal("only explanations are told about the tools")
	}
}

// Saved threads keep their explanation key under the name they always had.
func TestExplainKeySavedName(t *testing.T) {
	b, _ := json.Marshal(&thread{ExplainKey: "k"})
	if !strings.Contains(string(b), `"explainKey":"k"`) {
		t.Fatalf("thread JSON = %s", b)
	}
}
