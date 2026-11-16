package server

import (
	"testing"
	"time"
)

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
	req := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "symbol": "helper"}

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
	moved := map[string]any{"path": "main.go", "l1": 5, "l2": 5, "c1": 1, "c2": 7, "symbol": "helper"}
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
	first := map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "symbol": "helper"}
	second := map[string]any{"path": "main.go", "l1": 3, "l2": 3, "c1": 5, "c2": 9, "symbol": "main"}
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
	if code, _ := agentPostJSON(t, s, "/api/explain/prepare", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "symbol": "nope"}); code != 200 {
		t.Fatalf("mismatched prepare = %d", code)
	}
	explainSettings(t, map[string]any{"explain.prefetch": false})
	if code, _ := agentPostJSON(t, s, "/api/explain/prepare", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "symbol": "helper"}); code != 200 {
		t.Fatalf("prepare with prefetch off = %d", code)
	}
	if s.explainPre.gathers.Load() != 0 {
		t.Fatal("nothing should have been gathered")
	}
}
