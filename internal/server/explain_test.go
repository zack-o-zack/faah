package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"faah/internal/agents"
	"faah/internal/explain"
	"faah/internal/settings"
	"faah/internal/workspace"
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

// explainSettings writes explain.* settings for one test.
func explainSettings(t *testing.T, values map[string]any) {
	t.Helper()
	if err := settings.UpdateMap(values); err != nil {
		t.Fatal(err)
	}
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
	m, err := newAgentManager(root, "", nil, version)
	if err != nil {
		t.Fatal(err)
	}
	ix := workspace.NewIndex(root)
	ix.Build()
	s := New(Options{Workspace: ix, LSP: nil, Assets: assets, DevRoot: devRoot, Version: version})
	s.setAgent(m)
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
	if !strings.Contains(string(args), "haiku") || !strings.Contains(string(args), "default") || strings.Contains(string(args), "plan") {
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
