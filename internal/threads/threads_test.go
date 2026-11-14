package threads

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestThreadPrompt(t *testing.T) {
	th := &Thread{Path: "main.go", L1: 3, L2: 4, Snippet: "func main() {}"}
	first := threadPrompt(th, nil, "why?", false, "", false, testRuntime())
	if !strings.Contains(first, "@main.go lines 3-4") || !strings.Contains(first, "func main() {}") || !strings.HasSuffix(first, "why?") {
		t.Fatalf("first prompt = %q", first)
	}
	prior := []*Turn{{Prompt: "why?", Reply: "because", Changed: []string{"a.go"}}}
	if got := threadPrompt(th, prior, "and now?", false, "", false, testRuntime()); got != "and now?" {
		t.Fatalf("a live session should get the bare message, got %q", got)
	}
	replay := threadPrompt(th, prior, "and now?", true, "", false, testRuntime())
	for _, want := range []string{"@main.go", "User: why?", "Assistant: because", "a.go", "and now?"} {
		if !strings.Contains(replay, want) {
			t.Fatalf("replay prompt missing %q:\n%s", want, replay)
		}
	}
}

func TestThreadInterruptedTurnIsClosedOnLoad(t *testing.T) {
	isolateSettings(t)
	root := t.TempDir()
	m := testJobs(root, "")
	tm := testManager(m, root)
	tm.mu.Lock()
	tm.threads["t1"] = &Thread{ID: "t1", Title: "x", Turns: []*Turn{{ID: 1, Prompt: "p", Running: true}}}
	tm.saveLocked()
	tm.mu.Unlock()

	got := testManager(m, root).Get("t1")
	if got == nil || got.Turns[0].Running || !strings.Contains(got.Turns[0].Error, "interrupted") {
		t.Fatalf("interrupted turn = %+v", got)
	}
}

func TestThreadSinkStepLabels(t *testing.T) {
	root := t.TempDir()
	s := &threadSink{tm: &Manager{root: root}, tid: "t1", turn: &Turn{ID: 1}}
	s.Step("Read " + filepath.Join(root, "a", "b.go"))
	s.Step("mcp__faah__annotate")
	if want := []string{"Read " + filepath.Join("a", "b.go"), "Show notes"}; strings.Join(s.turn.Tools, "|") != strings.Join(want, "|") {
		t.Fatalf("tools %q, want %q", s.turn.Tools, want)
	}
}
