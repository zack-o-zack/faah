package review

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"faah/internal/threads"
)

// workflowThreadsStub makes snapshot and event completion deterministic.
type workflowThreadsStub struct {
	createError error
	previous    *threads.Thread
	initial     threads.Thread
	events      []threads.Thread
	prompts     []string
	missing     bool
}

func (f *workflowThreadsStub) Create(_, _ string, _, _ int, message, _ string) (*threads.Thread, error) {
	f.prompts = append(f.prompts, message)
	return &threads.Thread{ID: "thread"}, f.createError
}
func (f *workflowThreadsStub) Get(string) *threads.Thread { return f.previous }
func (f *workflowThreadsStub) Cancel(string) bool         { return true }
func (f *workflowThreadsStub) Subscribe(string) (<-chan threads.Event, threads.Event, func(), bool) {
	ch := make(chan threads.Event, len(f.events))
	for _, th := range f.events {
		data, _ := json.Marshal(th)
		ch <- threads.Event{Name: "thread", Data: data}
	}
	close(ch)
	data, _ := json.Marshal(f.initial)
	return ch, threads.Event{Name: "thread", Data: data}, func() {}, !f.missing
}

func TestReviewWorkflowUsesRequestedID(t *testing.T) {
	mgr := New(t.TempDir(), nil, nil)
	if err := mgr.SaveConfig(Config{Workflows: []WorkflowDef{
		{ID: "first", Stages: []StageDef{{ID: "first-stage"}}},
		{ID: "second", Stages: []StageDef{{ID: "second-stage"}}},
	}}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mgr.Stop() })
	run, err := mgr.Run("second", 0)
	if err != nil {
		t.Fatal(err)
	}
	if run.WorkflowID != "second" || len(run.Stages) != 1 || run.Stages[0].Def.ID != "second-stage" {
		t.Fatalf("wrong requested workflow: %+v", run)
	}
}

func TestReviewWorkflowIDsSurviveReload(t *testing.T) {
	root := t.TempDir()
	mgr := New(root, nil, nil)
	if err := mgr.SaveConfig(Config{Workflows: []WorkflowDef{
		{ID: "first", Name: "First", Stages: []StageDef{{ID: "first-stage"}}},
		{ID: "second", Name: "Second", Stages: []StageDef{{ID: "second-stage"}}},
	}}); err != nil {
		t.Fatal(err)
	}
	restored := New(root, nil, nil)
	if cfg := restored.Config(); len(cfg.Workflows) != 2 || cfg.Workflows[1].ID != "second" {
		t.Fatalf("saved workflow IDs were lost: %+v", cfg)
	}
	t.Cleanup(func() { restored.Stop() })
	run, err := restored.Run("second", 0)
	if err != nil {
		t.Fatal(err)
	}
	if run.WorkflowID != "second" {
		t.Fatalf("workflow ID after reload = %q", run.WorkflowID)
	}
}

func TestReviewWorkflowFailureIsTerminal(t *testing.T) {
	failed := threads.Thread{Turns: []*threads.Turn{{Error: "agent failed"}}}
	running := threads.Thread{Turns: []*threads.Turn{{Running: true}}}
	for _, tc := range []struct {
		name    string
		service Threads
		message string
	}{
		{"unavailable", nil, "AI thread system not available"},
		{"create", &workflowThreadsStub{createError: errors.New("create failed")}, "create failed"},
		{"subscribe", &workflowThreadsStub{missing: true}, "failed to subscribe to thread"},
		{"initial", &workflowThreadsStub{initial: failed}, "agent failed"},
		{"live", &workflowThreadsStub{initial: running, events: []threads.Thread{failed}}, "agent failed"},
		{"closed", &workflowThreadsStub{initial: running}, "thread event feed closed prematurely"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mgr := New(t.TempDir(), tc.service, nil)
			run := &Run{ID: "failure", Status: "running", Stages: []*StageState{{Def: StageDef{ID: "first"}, Status: "pending"}, {Def: StageDef{ID: "second"}, Status: "pending"}}}
			mgr.run = run
			ch, unsub := mgr.Subscribe()
			defer unsub()
			mgr.orchestrate(context.Background(), run, 0)
			got := mgr.CurrentRun()
			if got.Status != "failed" || got.Stages[0].Status != "failed" || got.Stages[0].Error != tc.message || got.Stages[0].Finished == 0 || got.Updated < got.Stages[0].Finished || got.Stages[1].Status != "pending" {
				t.Fatalf("failure not retained in terminal run: %+v, stage=%+v", got, got.Stages[0])
			}
			terminal := false
			for len(ch) > 0 {
				ev := <-ch
				if ev.Name == "run_completed" {
					var final Run
					if err := json.Unmarshal([]byte(ev.Data), &final); err != nil {
						t.Fatal(err)
					}
					if final.Status != "failed" || final.Stages[0].Error != tc.message {
						t.Fatalf("terminal event lost failure: %s", ev.Data)
					}
					terminal = true
				}
			}
			if !terminal {
				t.Fatal("missing terminal run event understood by frontend")
			}
		})
	}
}

func TestWaitForThreadTurnCompletionParity(t *testing.T) {
	for _, live := range []bool{false, true} {
		name := "snapshot"
		if live {
			name = "event"
		}
		t.Run(name, func(t *testing.T) {
			for _, tc := range []struct{ name, reply, problem, want string }{
				{"error", "", "agent failed", "agent failed"},
				{"reply-and-error", "partial reply", "agent warning", ""},
				{"reply", "done", "", ""},
				{"empty", "", "", ""},
			} {
				t.Run(tc.name, func(t *testing.T) {
					final := threads.Thread{Turns: []*threads.Turn{{Reply: tc.reply, Error: tc.problem}}}
					service := &workflowThreadsStub{initial: final}
					if live {
						service.initial = threads.Thread{Turns: []*threads.Turn{{Running: true}}}
						service.events = []threads.Thread{final}
					}
					mgr := New(t.TempDir(), service, nil)
					err := mgr.waitForThreadTurn(context.Background(), "thread")
					got := ""
					if err != nil {
						got = err.Error()
					}
					if got != tc.want {
						t.Fatalf("completion error = %q, want %q", got, tc.want)
					}
				})
			}
		})
	}
}

func TestReviewWorkflowContextPreservesUTF8(t *testing.T) {
	for _, tc := range []struct{ name, reply, want string }{
		{"ascii", strings.Repeat("x", 1900), strings.Repeat("x", 1800) + "..."},
		{"three-byte-rune", strings.Repeat("x", 1799) + "界tail", strings.Repeat("x", 1799) + "..."},
		{"four-byte-rune", strings.Repeat("x", 1798) + "🙂tail", strings.Repeat("x", 1798) + "..."},
		{"exact-limit", strings.Repeat("🙂", 450), strings.Repeat("🙂", 450)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := &workflowThreadsStub{previous: &threads.Thread{Turns: []*threads.Turn{{Reply: tc.reply}}}}
			mgr := New(t.TempDir(), service, nil)
			run := &Run{ID: "utf8", Status: "running", Stages: []*StageState{
				{Def: StageDef{ID: "first", Title: "Previous"}, ThreadID: "previous", Status: "completed"},
				{Def: StageDef{ID: "second", Prompt: "review", PassPreviousContext: true}, Status: "pending"},
			}}
			mgr.run = run
			mgr.orchestrate(context.Background(), run, 1)
			if len(service.prompts) != 1 {
				t.Fatalf("created %d threads", len(service.prompts))
			}
			prompt := service.prompts[0]
			if !utf8.ValidString(prompt) {
				t.Fatal("previous context split a UTF-8 rune")
			}
			if !strings.Contains(prompt, "\n\"\"\"\n"+tc.want+"\n\"\"\"\n") {
				t.Fatalf("unexpected previous context: %q", prompt)
			}
		})
	}
}

func TestReviewWorkflowSupersededRunCannotFinishReplacement(t *testing.T) {
	mgr := New(t.TempDir(), nil, nil)
	old := &Run{ID: "same-millisecond", Status: "running", Stages: []*StageState{{Status: "pending"}}}
	replacement := &Run{ID: old.ID, Status: "running", Stages: []*StageState{{Status: "pending"}}}
	mgr.run = replacement
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	mgr.orchestrate(ctx, old, 0)
	if got := mgr.CurrentRun(); got.Status != "running" {
		t.Fatalf("superseded orchestrator changed replacement status to %q", got.Status)
	}
}
