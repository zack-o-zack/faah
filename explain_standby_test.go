package main

import (
	"encoding/json"
	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/agents/claude"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// standbyServer runs Explain on a fake claude that, started ahead, waits for
// its prompt on stdin. Every run appends its arguments to claude-runs.txt and
// every prompt it reads to claude-stdin.txt, in the workspace.
func standbyServer(t *testing.T) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	writeExplainSource(t, root, explainGoSource)
	dir := t.TempDir()
	body := `#!/bin/sh
printf '%s\n' "$*" >> claude-runs.txt
case " $* " in
*" --input-format "*) IFS= read -r line; printf '%s\n' "$line" >> claude-stdin.txt ;;
esac
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}\n'
`
	if err := os.WriteFile(filepath.Join(dir, "claude"), []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	isolateSettings(t)
	m, err := newAgentManager(root, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	ix := NewIndex(root)
	ix.Build()
	s := NewServer(ix, nil)
	s.SetAgent(m)
	t.Cleanup(s.CloseThreads)
	explainSettings(t, map[string]any{"explain.agent": "claude", "explain.model": "haiku"})
	return s, root
}

func standbyLines(t *testing.T, root, name string) []string {
	t.Helper()
	data, _ := os.ReadFile(filepath.Join(root, name))
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

func waitStarts(t *testing.T, s *Server, n int32) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for s.threads.standby.starts.Load() != n {
		if time.Now().After(deadline) {
			t.Fatalf("standbys started = %d, want %d", s.threads.standby.starts.Load(), n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestStandbyArgvReadsPromptFromStdin(t *testing.T) {
	got := claude.New().StdinArgv([]string{"claude", "--permission-mode", "plan", "-p", "{prompt}"})
	want := []string{"claude", "--input-format", "stream-json", "--permission-mode", "plan", "-p", ""}
	if !slices.Equal(got, want) {
		t.Fatalf("argv = %q", got)
	}
	for name, field := range map[string]string{"claude": "type", "agy": "event"} {
		var m map[string]any
		if err := json.Unmarshal(all.For(name).(agents.Warmable).StdinMessage("hi"), &m); err != nil || m[field] != "user" {
			t.Fatalf("%s message = %v (%v)", name, m, err)
		}
	}
}

func TestExplainStandbyTakesFirstTurn(t *testing.T) {
	s, root := standbyServer(t)
	s.threads.warmExplain()
	s.threads.warmExplain() // one already waiting is kept
	waitStarts(t, s, 1)

	_, res := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	turn := th.Turns[0]
	if !turn.Warm || strings.TrimSpace(turn.Reply) != "ok" || turn.Error != "" {
		t.Fatalf("turn = %+v", turn)
	}
	runs := standbyLines(t, root, "claude-runs.txt")
	if !strings.Contains(runs[0], "--input-format stream-json") || !strings.Contains(runs[0], "--session-id "+th.SessionID) ||
		!strings.Contains(runs[0], "plan") || !strings.Contains(runs[0], "haiku") {
		t.Fatalf("standby ran %q (session %s)", runs[0], th.SessionID)
	}
	var msg struct {
		Type    string
		Message struct{ Content string }
	}
	if err := json.Unmarshal([]byte(standbyLines(t, root, "claude-stdin.txt")[0]), &msg); err != nil {
		t.Fatal(err)
	}
	if msg.Type != "user" || !strings.Contains(msg.Message.Content, "func helper()") {
		t.Fatalf("prompt on stdin = %+v", msg)
	}
	waitStarts(t, s, 2) // the next one is started once the turn ends
}

func TestExplainStandbyFollowsSettings(t *testing.T) {
	s, _ := standbyServer(t)
	s.threads.warmExplain()
	first := s.threads.standby.cur

	explainSettings(t, map[string]any{"explain.model": "sonnet"})
	s.threads.warmExplain()
	waitStarts(t, s, 2)
	select {
	case <-first.exited:
	case <-time.After(5 * time.Second):
		t.Fatal("a standby for the old model is still running")
	}

	explainSettings(t, map[string]any{"explain.warmup": false})
	second := s.threads.standby.cur
	s.threads.warmExplain()
	if s.threads.standby.cur != nil {
		t.Fatal("warm-up is off, yet a standby is kept")
	}
	<-second.exited
}

func TestExplainStandbyGoneRunsColdAndBacksOff(t *testing.T) {
	s, root := standbyServer(t)
	s.threads.warmExplain()
	sp := s.threads.standby.cur
	standbyKill(sp.cmd) // dies on its own, as far as faah knows
	<-sp.exited
	deadline := time.Now().Add(5 * time.Second)
	for {
		s.threads.standby.mu.Lock()
		cur := s.threads.standby.cur
		s.threads.standby.mu.Unlock()
		if cur == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a dead standby was kept")
		}
		time.Sleep(10 * time.Millisecond)
	}

	_, res := agentPostJSON(t, s, "/api/explain", map[string]any{"path": "main.go", "l1": 4, "l2": 4, "c1": 1, "c2": 7, "text": "helper"})
	th := waitThreadIdle(t, s, res["thread"].(map[string]any)["id"].(string))
	if th.Turns[0].Warm || strings.TrimSpace(th.Turns[0].Reply) != "ok" {
		t.Fatalf("turn = %+v", th.Turns[0])
	}
	runs := standbyLines(t, root, "claude-runs.txt")
	if last := runs[len(runs)-1]; strings.Contains(last, "--input-format") {
		t.Fatalf("turn ran %q, want a cold start", last)
	}

	s.threads.warmExplain() // too soon after one died
	if n := s.threads.standby.starts.Load(); n != 1 {
		t.Fatalf("standbys started = %d, want no retry yet", n)
	}
}
