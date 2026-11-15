package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"faah/internal/agents"
	"faah/internal/threads"
)

// threadPrompt exercises the private prompt assembly through a native turn.
// The saved transcript supplies the same prior turns and resume state.
func threadPrompt(tb *testing.T, th *threads.Thread, prior []*threads.Turn, message string, replay bool, prCtx string, scopeChanged bool) string {
	tb.Helper()
	root := tb.TempDir()
	file := filepath.Join(tb.TempDir(), "threads.json")
	candidate := *th
	candidate.ID, candidate.SessionID = "t1", "remembered"
	if replay {
		candidate.SessionID = ""
	}
	candidate.Scope, candidate.ScopeSent = "pr", "pr"
	if scopeChanged {
		candidate.Scope = "mine"
	}
	candidate.Turns = make([]*threads.Turn, len(prior))
	for i, turn := range prior {
		c := *turn
		c.Harness = "claude"
		candidate.Turns[i] = &c
	}
	data, _ := json.Marshal(map[string]any{"root": root, "threads": []*threads.Thread{&candidate}})
	os.WriteFile(file, data, 0600)
	a := &agentManager{selected: "claude", args: []string{"claude"}, models: map[string]string{}}
	a.openAgent = func(string) agents.Agent {
		return &fakeAgent{PromptFunc: func(_ context.Context, _ agents.Open, prompt string, sink agents.Sink) error {
			sink.Text(prompt, false)
			return nil
		}}
	}
	a.Jobs = threads.NewJobs(root, version, a.current, func(name string) agents.Agent { return a.openAgent(name) })
	a.SetHooks(threads.Hooks{PRContext: func(string) string { return prCtx }})
	tm := newThreadManagerAt(a, root, file)
	tb.Cleanup(tm.Close)
	tm.Send(candidate.ID, message)
	// Use the existing host waiter without exposing service internals.
	return waitThreadIdle(tb, &Server{threads: tm}, candidate.ID).Turns[len(prior)].Reply
}
