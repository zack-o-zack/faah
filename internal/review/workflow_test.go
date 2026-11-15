package review

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

func TestReviewWorkflowDefaults(t *testing.T) {
	defs := defaultWorkflows()
	if len(defs) == 0 {
		t.Fatal("expected default workflows, got none")
	}

	standard := defs[0]
	if standard.ID != "standard" {
		t.Fatalf("expected first workflow to be 'standard', got %q", standard.ID)
	}
	if len(standard.Stages) != 4 {
		t.Fatalf("expected standard workflow to have 4 stages, got %d", len(standard.Stages))
	}
	for i, st := range standard.Stages {
		if st.Title == "" || st.Prompt == "" || st.Question == "" {
			t.Fatalf("stage %d in standard workflow is missing required fields: %+v", i, st)
		}
	}
}

func TestReviewWorkflowConfigCorruptAndSaveValidation(t *testing.T) {
	tmp := t.TempDir()
	mgr := New(tmp, nil, nil)

	// Create corrupt workflows.json
	workflowDir := filepath.Join(tmp, ".faah")
	if err := os.MkdirAll(workflowDir, 0755); err != nil {
		t.Fatalf("failed to create dir: %v", err)
	}
	corruptPath := filepath.Join(workflowDir, "workflows.json")
	if err := os.WriteFile(corruptPath, []byte("invalid json {{{"), 0644); err != nil {
		t.Fatalf("failed to write corrupt config: %v", err)
	}

	// Loading corrupt config should fallback to default workflows
	loaded := mgr.loadConfig()
	if len(loaded.Workflows) == 0 || loaded.ActiveID != "standard" {
		t.Fatalf("expected fallback to default workflows on corrupt config, got %+v", loaded)
	}

	// Save empty workflow config should fail validation
	emptyCfg := Config{Workflows: []WorkflowDef{}}
	err := mgr.SaveConfig(emptyCfg)
	if err == nil {
		t.Fatal("expected error when saving empty workflow config")
	}
}

func TestReviewWorkflowRunAndOrchestration(t *testing.T) {
	tmp := t.TempDir()
	mgr := New(tmp, nil, nil)
	fakeCLI(t, "claude")
	firstReply, secondReply := make(chan string), make(chan string)
	tm, err := testThreadManager(tmp, func(string) agents.Agent {
		return &fakeAgent{PromptFunc: func(ctx context.Context, _ agents.Open, prompt string, sink agents.Sink) error {
			replies := firstReply
			if strings.Contains(prompt, "Prompt 2") {
				replies = secondReply
			}
			select {
			case reply := <-replies:
				sink.Text(reply, false)
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}}
	})
	if err != nil {
		t.Fatalf("failed to create agent manager: %v", err)
	}
	mgr.SetThreads(tm)
	t.Cleanup(tm.Close)

	customCfg := Config{
		Workflows: []WorkflowDef{
			{
				ID:   "test-flow",
				Name: "Test Flow",
				Stages: []StageDef{
					{
						ID:                  "stg1",
						Title:               "Stage 1",
						Question:            "Question 1?",
						Prompt:              "Prompt 1",
						PassPreviousContext: false,
					},
					{
						ID:                  "stg2",
						Title:               "Stage 2",
						Question:            "Question 2?",
						Prompt:              "Prompt 2",
						PassPreviousContext: true,
					},
				},
			},
		},
		ActiveID: "test-flow",
	}
	if err := mgr.SaveConfig(customCfg); err != nil {
		t.Fatalf("failed to save config: %v", err)
	}

	// Start workflow run
	run, err := mgr.Run("test-flow", 0)
	if err != nil {
		t.Fatalf("failed to start workflow: %v", err)
	}
	if run == nil || run.Status != "running" {
		t.Fatalf("expected running status, got %+v", run)
	}

	// Simulate completing thread turns in background for stages
	longReply := strings.Repeat("X", 2000)
	done := make(chan struct{})

	go func() {
		defer close(done)
		for i := 0; i < 100; i++ {
			time.Sleep(20 * time.Millisecond)
			r := mgr.CurrentRun()
			if r == nil {
				continue
			}

			// Complete stage 0 turn
			if len(r.Stages) > 0 && r.Stages[0].ThreadID != "" && r.Stages[0].Status == "running" {
				stg0Thread := tm.Get(r.Stages[0].ThreadID)
				if stg0Thread != nil && stg0Thread.Running() {
					firstReply <- longReply
				}
			}

			// Complete stage 1 turn
			if len(r.Stages) > 1 && r.Stages[1].ThreadID != "" && r.Stages[1].Status == "running" {
				stg1Thread := tm.Get(r.Stages[1].ThreadID)
				if stg1Thread != nil && stg1Thread.Running() {
					secondReply <- "Stage 2 done"
				}
			}

			if r.Status == "completed" {
				return
			}
		}
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for workflow completion")
	}

	finalRun := mgr.CurrentRun()
	if finalRun.Status != "completed" {
		t.Fatalf("expected run status completed, got %s", finalRun.Status)
	}

	// Verify context passing in stage 2 prompt
	stg1Thread := tm.Get(finalRun.Stages[1].ThreadID)
	if stg1Thread == nil || len(stg1Thread.Turns) == 0 {
		t.Fatal("expected stage 2 thread to exist")
	}
	stg2Prompt := stg1Thread.Turns[0].Prompt
	if !strings.Contains(stg2Prompt, "Context from previous review stage (Stage 1):") {
		t.Fatalf("expected stage 2 prompt to include previous context, got %s", stg2Prompt)
	}
}

func TestReviewWorkflowRunUnknownIDAndNilThreads(t *testing.T) {
	tmp := t.TempDir()
	mgr := New(tmp, nil, nil)

	// Run with unknown ID falls back to first workflow definition
	run, err := mgr.Run("non-existent-id", 0)
	if err != nil {
		t.Fatalf("expected fallback for unknown workflow id, got error: %v", err)
	}
	if run.WorkflowID != "standard" {
		t.Fatalf("expected workflow standard, got %s", run.WorkflowID)
	}

	// Since s.threads is nil, orchestration should mark stage as failed
	time.Sleep(50 * time.Millisecond)
	updatedRun := mgr.CurrentRun()
	if updatedRun.Stages[0].Status != "failed" {
		t.Fatalf("expected stage status failed when threads system is nil, got %s", updatedRun.Stages[0].Status)
	}
	if !strings.Contains(updatedRun.Stages[0].Error, "AI thread system not available") {
		t.Fatalf("expected AI thread system not available error, got %s", updatedRun.Stages[0].Error)
	}
}

func TestReviewWorkflowStopActiveRun(t *testing.T) {
	tmp := t.TempDir()
	mgr := New(tmp, nil, nil)
	fakeCLI(t, "claude")
	tm, err := testThreadManager(tmp, nil)
	if err != nil {
		t.Fatalf("failed to create agent manager: %v", err)
	}
	mgr.SetThreads(tm)

	run, err := mgr.Run("standard", 0)
	if err != nil {
		t.Fatalf("failed to start workflow: %v", err)
	}
	if run.Status != "running" {
		t.Fatalf("expected run status running, got %s", run.Status)
	}

	time.Sleep(50 * time.Millisecond)

	stoppedRun, err := mgr.Stop()
	if err != nil {
		t.Fatalf("failed to stop run: %v", err)
	}
	if stoppedRun.Status != "stopped" {
		t.Fatalf("expected run status stopped, got %s", stoppedRun.Status)
	}
}
