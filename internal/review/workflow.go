// Package review owns review workflows and diff walkthroughs.
package review

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"faah/internal/threads"
)

// WorkflowDef defines a customizable multi-stage review pipeline.
type WorkflowDef struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Stages      []StageDef `json:"stages"`
}

// StageDef represents a single review stage / question in the pipeline.
type StageDef struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	Question            string `json:"question"`
	Prompt              string `json:"prompt"`
	PassPreviousContext bool   `json:"passPreviousContext"`
	Harness             string `json:"harness,omitempty"`
	Model               string `json:"model,omitempty"`
}

// StageState tracks the live execution of a single stage.
type StageState struct {
	Def      StageDef `json:"def"`
	ThreadID string   `json:"threadId,omitempty"`
	Status   string   `json:"status"` // "pending", "running", "completed", "failed", "stopped"
	Error    string   `json:"error,omitempty"`
	Started  int64    `json:"started,omitempty"`
	Finished int64    `json:"finished,omitempty"`
}

// Run represents an active or past execution of a workflow.
type Run struct {
	ID          string        `json:"id"`
	WorkflowID  string        `json:"workflowId"`
	Status      string        `json:"status"` // "idle", "running", "completed", "stopped", "failed"
	ActiveStage int           `json:"activeStage"`
	Stages      []*StageState `json:"stages"`
	Created     int64         `json:"created"`
	Updated     int64         `json:"updated"`
}

// Config holds the review workflow stages and metadata.
type Config struct {
	Name      string        `json:"name"`
	Stages    []StageDef    `json:"stages"`
	Workflows []WorkflowDef `json:"workflows,omitempty"`
	ActiveID  string        `json:"activeId,omitempty"`
}

// defaultWorkflows returns the single default review workflow.
func defaultWorkflows() []WorkflowDef {
	return []WorkflowDef{
		{
			ID:          "standard",
			Name:        "Review pipeline",
			Description: "Sequential review workflow answering key PR questions: intent, performance, quality, and testing.",
			Stages: []StageDef{
				{
					ID:                  "summary",
					Title:               "What this PR does",
					Question:            "What does this PR do and what problem does it solve?",
					Prompt:              "Analyze this pull request's diff and description. Provide a concise explanation of what this PR accomplishes, what problem it solves, and list the key components and files changed. Cite file paths and line ranges where relevant.",
					PassPreviousContext: false,
				},
				{
					ID:                  "performance",
					Title:               "Performance Impact",
					Question:            "Are there any performance bottlenecks, lock contentions, or leaks?",
					Prompt:              "Review the changes for performance implications: computational complexity, memory allocations, potential blocking I/O operations, database/network bottlenecks, or mutex/lock contention. Identify any hotspots with exact file:line references.",
					PassPreviousContext: true,
				},
				{
					ID:                  "architecture",
					Title:               "Architecture & Quality",
					Question:            "How does this impact design modularity, edge cases, and maintainability?",
					Prompt:              "Evaluate the software architecture, design modularity, readability, maintainability, and error handling. Note any anti-patterns, edge cases that might fail silently, or breaking API changes.",
					PassPreviousContext: true,
				},
				{
					ID:                  "testing",
					Title:               "Testing & Edge Cases",
					Question:            "Are there missing tests or verification steps?",
					Prompt:              "Check test coverage for the changes. Are new code paths, error states, and edge conditions tested? Suggest specific tests or verification checks if coverage is incomplete.",
					PassPreviousContext: true,
				},
			},
		},
	}
}

// Threads is the thread service consumed by workflow execution.
type Threads interface {
	Create(abs, rel string, l1, l2 int, message, scope string) (*threads.Thread, error)
	Get(id string) *threads.Thread
	Cancel(id string) bool
	Subscribe(id string) (<-chan threads.Event, threads.Event, func(), bool)
}

// Manager coordinates workflow definitions and sequential multi-stage execution.
type Manager struct {
	root     string
	threads  Threads
	scope    func() string
	mu       sync.Mutex
	config   Config
	run      *Run
	cancelFn context.CancelFunc
	subs     map[chan Event]struct{}
}

type Event struct {
	Name string `json:"event"`
	Data string `json:"data"`
}

// New loads the workspace workflow configuration and wires its thread service.
func New(root string, threads Threads, scope func() string) *Manager {
	mgr := &Manager{
		root:    root,
		threads: threads,
		scope:   scope,
		subs:    make(map[chan Event]struct{}),
	}
	mgr.loadConfig()
	return mgr
}

// SetThreads updates the thread service when the host changes its agent.
func (m *Manager) SetThreads(threads Threads) {
	m.threads = threads
}

func (m *Manager) configFilePath() string {
	if m.root == "" {
		return ""
	}
	return filepath.Join(m.root, ".faah", "workflows.json")
}

func (m *Manager) loadConfig() Config {
	m.mu.Lock()
	defer m.mu.Unlock()

	defaults := defaultWorkflows()
	cfg := Config{
		Name:      defaults[0].Name,
		Stages:    defaults[0].Stages,
		Workflows: defaults,
		ActiveID:  defaults[0].ID,
	}

	p := m.configFilePath()
	if p != "" {
		if data, err := os.ReadFile(p); err == nil {
			var loaded Config
			if err := json.Unmarshal(data, &loaded); err == nil {
				if len(loaded.Workflows) > 0 {
					cfg.Workflows = loaded.Workflows
					cfg.Name = loaded.Workflows[0].Name
					cfg.Stages = loaded.Workflows[0].Stages
					cfg.ActiveID = loaded.Workflows[0].ID
				} else if len(loaded.Stages) > 0 {
					cfg.Stages = loaded.Stages
					if loaded.Name != "" {
						cfg.Name = loaded.Name
					}
					cfg.Workflows = []WorkflowDef{{ID: "standard", Name: cfg.Name, Stages: cfg.Stages}}
					cfg.ActiveID = "standard"
				}
			}
		}
	}
	// The old default name was renamed; a saved config still holding it shows the new one.
	if cfg.Name == "PR Review Workflow" {
		cfg.Name = defaults[0].Name
		for i := range cfg.Workflows {
			if cfg.Workflows[i].Name == "PR Review Workflow" {
				cfg.Workflows[i].Name = cfg.Name
			}
		}
	}
	m.config = cfg
	return cfg
}

func (m *Manager) SaveConfig(cfg Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(cfg.Stages) > 0 {
		if cfg.Name == "" {
			cfg.Name = "Review pipeline"
		}
		cfg.Workflows = []WorkflowDef{
			{
				ID:     "standard",
				Name:   cfg.Name,
				Stages: cfg.Stages,
			},
		}
		cfg.ActiveID = "standard"
	} else if len(cfg.Workflows) > 0 {
		cfg.Name = cfg.Workflows[0].Name
		cfg.Stages = cfg.Workflows[0].Stages
		cfg.ActiveID = cfg.Workflows[0].ID
	} else {
		return errors.New("at least one stage is required in the review workflow")
	}
	m.config = cfg

	// Sync active run's stage definitions if a run exists
	if m.run != nil {
		activeStages := cfg.Stages
		newStages := make([]*StageState, len(activeStages))
		for i, st := range activeStages {
			found := false
			for _, existing := range m.run.Stages {
				if existing.Def.ID == st.ID {
					existingCopy := *existing
					existingCopy.Def = st
					newStages[i] = &existingCopy
					found = true
					break
				}
			}
			if !found {
				newStages[i] = &StageState{
					Def:    st,
					Status: "pending",
				}
			}
		}
		m.run.Stages = newStages
		if m.run.ActiveStage >= len(newStages) {
			if len(newStages) > 0 {
				m.run.ActiveStage = len(newStages) - 1
			} else {
				m.run.ActiveStage = 0
			}
		}
		m.broadcastLocked("run_started", m.run)
	}

	p := m.configFilePath()
	if p == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

func (m *Manager) Config() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.config
}

func (m *Manager) CurrentRun() *Run {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.run == nil {
		return nil
	}
	// Return a copy
	c := *m.run
	c.Stages = make([]*StageState, len(m.run.Stages))
	for i, st := range m.run.Stages {
		stCopy := *st
		c.Stages[i] = &stCopy
	}
	return &c
}

func (m *Manager) broadcastLocked(name string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	ev := Event{Name: name, Data: string(data)}
	for ch := range m.subs {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Run starts executing the chosen workflow sequentially stage by stage.
func (m *Manager) Run(workflowID string, startStageIndex int) (*Run, error) {
	m.mu.Lock()

	// An omitted ID uses the configured default; an explicit ID must match.
	if workflowID == "" {
		workflowID = m.config.ActiveID
		if workflowID == "" && len(m.config.Workflows) > 0 {
			workflowID = m.config.Workflows[0].ID
		}
		if workflowID == "" {
			workflowID = "standard"
		}
	}
	var targetDef *WorkflowDef
	for i := range m.config.Workflows {
		if m.config.Workflows[i].ID == workflowID {
			targetDef = &m.config.Workflows[i]
			break
		}
	}
	if targetDef == nil && workflowID == "standard" && len(m.config.Workflows) == 0 && len(m.config.Stages) > 0 {
		targetDef = &WorkflowDef{ID: "standard", Name: m.config.Name, Stages: m.config.Stages}
	}
	if targetDef == nil {
		m.mu.Unlock()
		return nil, fmt.Errorf("unknown review workflow %q", workflowID)
	}
	if len(targetDef.Stages) == 0 {
		m.mu.Unlock()
		return nil, errors.New("no stages defined in review workflow")
	}

	// Cancel previous run if still active
	if m.cancelFn != nil {
		m.cancelFn()
		m.cancelFn = nil
	}

	if startStageIndex < 0 || startStageIndex >= len(targetDef.Stages) {
		startStageIndex = 0
	}

	stages := make([]*StageState, len(targetDef.Stages))
	for i, st := range targetDef.Stages {
		status := "pending"
		var prevThreadID string
		// Preserve previous stages if resuming from a mid-point
		if m.run != nil && m.run.WorkflowID == targetDef.ID && i < len(m.run.Stages) {
			if i < startStageIndex {
				status = m.run.Stages[i].Status
				prevThreadID = m.run.Stages[i].ThreadID
			}
		}
		stages[i] = &StageState{
			Def:      st,
			Status:   status,
			ThreadID: prevThreadID,
		}
	}

	run := &Run{
		ID:          fmt.Sprintf("wf-%d", time.Now().UnixMilli()),
		WorkflowID:  targetDef.ID,
		Status:      "running",
		ActiveStage: startStageIndex,
		Stages:      stages,
		Created:     time.Now().UnixMilli(),
		Updated:     time.Now().UnixMilli(),
	}
	m.run = run

	ctx, cancel := context.WithCancel(context.Background())
	m.cancelFn = cancel

	m.broadcastLocked("run_started", run)
	m.mu.Unlock()

	go m.orchestrate(ctx, run, startStageIndex)

	return m.CurrentRun(), nil
}

// Stop cancels the running stage and pauses the workflow.
func (m *Manager) Stop() (*Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.run == nil || m.run.Status != "running" {
		return m.run, nil
	}

	if m.cancelFn != nil {
		m.cancelFn()
		m.cancelFn = nil
	}

	m.run.Status = "stopped"
	m.run.Updated = time.Now().UnixMilli()
	if m.run.ActiveStage >= 0 && m.run.ActiveStage < len(m.run.Stages) {
		curr := m.run.Stages[m.run.ActiveStage]
		if curr.Status == "running" {
			curr.Status = "stopped"
			curr.Finished = time.Now().UnixMilli()
			if curr.ThreadID != "" && m.threads != nil {
				m.threads.Cancel(curr.ThreadID)
			}
		}
	}
	m.broadcastLocked("run_stopped", m.run)
	return m.run, nil
}

func (m *Manager) orchestrate(ctx context.Context, run *Run, startIdx int) {
	defer func() {
		m.mu.Lock()
		if m.run == run && run.Status == "running" {
			run.Status = "completed"
			for _, stage := range run.Stages {
				if stage.Status == "failed" || stage.Status == "stopped" {
					run.Status = stage.Status
					break
				}
			}
			m.run.Updated = time.Now().UnixMilli()
			m.broadcastLocked("run_completed", m.run)
		}
		m.mu.Unlock()
	}()

	for idx := startIdx; idx < len(run.Stages); idx++ {
		select {
		case <-ctx.Done():
			return
		default:
		}

		stage := run.Stages[idx]
		m.mu.Lock()
		run.ActiveStage = idx
		stage.Status = "running"
		stage.Started = time.Now().UnixMilli()
		run.Updated = stage.Started
		m.broadcastLocked("stage_started", map[string]any{
			"runId":      run.ID,
			"stageIndex": idx,
			"stage":      stage,
		})
		m.mu.Unlock()

		// Build prompt with context if requested
		fullPrompt := stage.Def.Prompt
		if stage.Def.PassPreviousContext && idx > 0 {
			prevStage := run.Stages[idx-1]
			if prevStage.ThreadID != "" && m.threads != nil {
				if prevT := m.threads.Get(prevStage.ThreadID); prevT != nil && len(prevT.Turns) > 0 {
					prevReply := strings.TrimSpace(prevT.Turns[len(prevT.Turns)-1].Reply)
					if len(prevReply) > 1800 {
						end := 1800
						for !utf8.RuneStart(prevReply[end]) {
							end--
						}
						prevReply = prevReply[:end] + "..."
					}
					if prevReply != "" {
						fullPrompt = fmt.Sprintf("Context from previous review stage (%s):\n\"\"\"\n%s\n\"\"\"\n\nReview Question for this stage:\n%s\n\nInstructions:\n%s",
							prevStage.Def.Title, prevReply, stage.Def.Question, stage.Def.Prompt)
					}
				}
			}
		}

		// Determine scope: if PR review session, scope is "pr", else ""
		scope := ""
		if m.scope != nil {
			scope = m.scope()
		}

		if m.threads == nil {
			m.mu.Lock()
			stage.Status = "failed"
			stage.Error = "AI thread system not available"
			stage.Finished = time.Now().UnixMilli()
			m.broadcastLocked("stage_failed", stage)
			m.mu.Unlock()
			return
		}

		// Create thread and trigger turn execution
		t, err := m.threads.Create("", "", 0, 0, fullPrompt, scope)
		if err != nil {
			m.mu.Lock()
			stage.Status = "failed"
			stage.Error = err.Error()
			stage.Finished = time.Now().UnixMilli()
			m.broadcastLocked("stage_failed", stage)
			m.mu.Unlock()
			return
		}

		m.mu.Lock()
		stage.ThreadID = t.ID
		m.broadcastLocked("stage_updated", map[string]any{
			"runId":      run.ID,
			"stageIndex": idx,
			"stage":      stage,
		})
		m.mu.Unlock()

		// Wait for thread turn to complete
		err = m.waitForThreadTurn(ctx, t.ID)
		if err != nil {
			m.mu.Lock()
			if errors.Is(err, context.Canceled) {
				stage.Status = "stopped"
			} else {
				stage.Status = "failed"
				stage.Error = err.Error()
			}
			stage.Finished = time.Now().UnixMilli()
			m.broadcastLocked("stage_failed", stage)
			m.mu.Unlock()
			return
		}

		m.mu.Lock()
		stage.Status = "completed"
		stage.Finished = time.Now().UnixMilli()
		run.Updated = stage.Finished
		m.broadcastLocked("stage_completed", map[string]any{
			"runId":      run.ID,
			"stageIndex": idx,
			"stage":      stage,
		})
		m.mu.Unlock()

		// Brief pause between stages
		select {
		case <-ctx.Done():
			return
		case <-time.After(300 * time.Millisecond):
		}
	}
}

func (m *Manager) waitForThreadTurn(ctx context.Context, threadID string) error {
	ch, initial, unsub, ok := m.threads.Subscribe(threadID)
	if !ok {
		return errors.New("failed to subscribe to thread")
	}
	defer unsub()

	// Check initial state
	if initial.Name == "thread" {
		var t threads.Thread
		if err := json.Unmarshal(initial.Data, &t); err == nil {
			if !t.Running() {
				return threadTurnError(&t)
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			m.threads.Cancel(threadID)
			return context.Canceled
		case ev, open := <-ch:
			if !open {
				return errors.New("thread event feed closed prematurely")
			}
			if ev.Name == "thread" {
				var t threads.Thread
				if err := json.Unmarshal(ev.Data, &t); err == nil {
					if !t.Running() {
						return threadTurnError(&t)
					}
				}
			}
		}
	}
}

// threadTurnError preserves replies that arrived before an agent error, while
// treating an error without a reply as a failed stage on either completion path.
func threadTurnError(t *threads.Thread) error {
	if len(t.Turns) > 0 {
		last := t.Turns[len(t.Turns)-1]
		if last.Error != "" && last.Reply == "" {
			return errors.New(last.Error)
		}
	}
	return nil
}

func (m *Manager) Subscribe() (chan Event, func()) {
	m.mu.Lock()
	defer m.mu.Unlock()

	ch := make(chan Event, 64)
	m.subs[ch] = struct{}{}
	unsub := func() {
		m.mu.Lock()
		delete(m.subs, ch)
		close(ch)
		m.mu.Unlock()
	}
	return ch, unsub
}
