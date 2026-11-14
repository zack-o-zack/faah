package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/px0-ai/harness"

	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/git"
	"faah/internal/httpx"
	lsppkg "faah/internal/lsp"
	"faah/internal/processio"
	"faah/internal/render"
	"faah/internal/settings"
	"faah/internal/threads"
	"faah/internal/ui"
)

// Agents edit the workspace through native sessions. faah supplies instructions,
// streams their progress, and reloads changed files when each turn ends. The
// harness package provides discovery and model lists; adapters own execution.

const (
	agentTimeout  = harness.DefaultTimeout
	agentLogBytes = harness.DefaultLogBytes
)

// agentHarness is one row of the picker.
type agentHarness struct {
	Name      string   `json:"name"`
	Cmd       string   `json:"cmd"`
	Installed bool     `json:"installed"`
	Path      string   `json:"path,omitempty"`
	Models    []string `json:"models,omitempty"`
	Model     string   `json:"model,omitempty"`
}

var (
	// The refusals the UI reacts to rather than merely reporting.
	errAgentBusy  = errors.New("an edit is already running")
	errAgentDirty = errors.New("uncommitted")
	errAgentNone  = threads.ErrNoAgent
)

// agentManager owns discovery, the current choice, and every edit currently in
// flight. Several harnesses can run at once as long as they touch disjoint
// line ranges: two harnesses rewriting the same lines produces a state nobody
// can review afterwards, so overlapping ranges are refused rather than queued.
type agentManager struct {
	*threads.Jobs
	openAgent func(string) agents.Agent

	mu       sync.Mutex
	selected string            // native agent name
	args     []string          // resolved argv, nil when nothing is selected
	pinned   bool              // -agent was given, so the UI cannot change it
	models   map[string]string // harness name -> selected model

}

// newAgentManager wires discovery and restores the remembered choice. A flag
// value pins an agent for this run. This is
// the only case that can fail: a bad -agent should stop startup, whereas a
// stale settings file should just leave nothing selected.
func newAgentManager(root, flagSpec string, lsp *lsppkg.Manager) (*agentManager, error) {
	m := &agentManager{
		openAgent: all.For,
		models:    map[string]string{},
	}
	m.Jobs = threads.NewJobs(root, version, m.current, func(name string) agents.Agent { return m.openAgent(name) })
	m.SetHooks(threads.Hooks{AfterEdit: func(changed []string) {
		for _, rel := range changed {
			abs := filepath.Join(root, filepath.FromSlash(rel))
			render.Evict(abs)
			if lsp != nil {
				lsp.CloseDoc(abs, rel)
			}
		}
	}})
	s := settings.Read()
	if s.Models != nil {
		for k, v := range s.Models {
			m.models[k] = v
		}
	}

	if spec := strings.TrimSpace(flagSpec); spec != "" {
		name, args, chosenModel, err := resolveAgentSpec(spec, m.models[spec])
		if err != nil {
			return nil, err
		}
		m.selected, m.args, m.pinned = name, args, true
		if chosenModel != "" {
			m.models[name] = chosenModel
		}
		return m, nil
	}

	if s.Agent != "" {
		if name, args, chosenModel, err := resolveAgentSpec(s.Agent, m.models[s.Agent]); err == nil {
			m.selected, m.args = name, args
			if chosenModel != "" {
				m.models[name] = chosenModel
			}
		}
	}
	return m, nil
}

// resolveAgentSpec validates a native agent name and locates its executable.
func resolveAgentSpec(name, model string) (string, []string, string, error) {
	if err := all.ValidateName(name); err != nil {
		return "", nil, "", err
	}
	binary, ok := harness.LookPath(name)
	if !ok {
		return "", nil, "", fmt.Errorf("%s is not installed", name)
	}
	return name, []string{binary}, strings.TrimSpace(model), nil
}

// Detect reports every harness known and whether it is installed right
// now, so a tool installed since startup shows up without a restart.
// Models are only discovered for the currently selected harness to avoid
// executing external commands (such as `agy models`) on startup for unused tools.
func (m *agentManager) Detect() []agentHarness {
	m.mu.Lock()
	savedModels := make(map[string]string, len(m.models))
	for k, v := range m.models {
		savedModels[k] = v
	}
	selected := m.selected
	m.mu.Unlock()

	detected := harness.Detect(savedModels)
	out := make([]agentHarness, 0, len(detected))
	for _, h := range detected {
		if all.For(h.Name) == nil {
			continue
		}
		var models []string
		if h.Installed && h.Name == selected {
			if list, err := harness.DiscoverModels(context.Background(), h.Name); err == nil {
				models = list
			}
		}
		curModel := h.Model
		if curModel == "" && len(models) > 0 {
			curModel = models[0]
		}
		out = append(out, agentHarness{
			Name:      h.Name,
			Cmd:       h.Name,
			Installed: h.Installed,
			Path:      h.Path,
			Models:    models,
			Model:     curModel,
		})
	}
	return out
}

func (m *agentManager) Name() string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.selected
}

func (m *agentManager) Model() string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.selected == "" {
		return ""
	}
	return m.models[m.selected]
}

// current returns the selected harness, its headless argv and its model, read
// together so a run never mixes one harness's name with another's flags.
func (m *agentManager) current() (string, []string, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.args == nil {
		return "", nil, ""
	}
	return m.selected, append([]string(nil), m.args...), m.models[m.selected]
}

func (m *agentManager) Pinned() bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pinned
}

// Select remembers a harness for this workspace and every later run. Passing an
// empty name turns editing back off.
func (m *agentManager) Select(name string, modelOpt ...string) error {
	m.mu.Lock()
	if m.pinned {
		m.mu.Unlock()
		return errors.New("faah was started with -agent, so the harness is fixed for this run")
	}
	m.mu.Unlock()

	name = strings.TrimSpace(name)
	if name == "" {
		m.mu.Lock()
		m.selected, m.args = "", nil
		m.mu.Unlock()
		return settings.Write(settings.Settings{})
	}

	reqModel := ""
	if len(modelOpt) > 0 {
		reqModel = strings.TrimSpace(modelOpt[0])
	}
	m.mu.Lock()
	if reqModel == "" {
		reqModel = m.models[name]
	}
	m.mu.Unlock()

	display, args, chosenModel, err := resolveAgentSpec(name, reqModel)
	if err != nil {
		ui.Status("err", fmt.Sprintf("agent: failed to select harness %q", name), err.Error(), 0, os.Stdout)
		return err
	}
	m.mu.Lock()
	m.selected, m.args = display, args
	if m.models == nil {
		m.models = map[string]string{}
	}
	if chosenModel != "" {
		m.models[display] = chosenModel
	}
	savedModels := make(map[string]string, len(m.models))
	for k, v := range m.models {
		savedModels[k] = v
	}
	m.mu.Unlock()

	modelNote := ""
	if chosenModel != "" {
		modelNote = fmt.Sprintf(" (%s)", chosenModel)
	}
	ui.Status("ok", "agent", fmt.Sprintf("%s%s", display, modelNote), 0, os.Stdout)
	return settings.Write(settings.Settings{Agent: name, Models: savedModels})
}

// ---------------------------------------------------------------- HTTP

func (s *Server) agentOrFail(w http.ResponseWriter) bool {
	if s.agent == nil {
		httpx.Fail(w, http.StatusNotFound, "editing is not available in this session")
		return false
	}
	return true
}

// handleAgentHarnesses backs the picker. It re-scans on every call so a harness
// installed since startup appears without a restart.
func (s *Server) handleAgentHarnesses(w http.ResponseWriter, r *http.Request) {
	if !s.agentOrFail(w) {
		return
	}
	httpx.WriteJSON(w, map[string]any{
		"harnesses": s.agent.Detect(),
		"selected":  s.agent.Name(),
		"model":     s.agent.Model(),
		"pinned":    s.agent.Pinned(),
		"settings":  settings.Path(),
	})
}

// Browsing an agent discovers its models without selecting it or writing settings.
func (s *Server) handleAgentModels(w http.ResponseWriter, r *http.Request) {
	if !s.agentOrFail(w) {
		return
	}
	if r.Method != http.MethodGet {
		httpx.Fail(w, http.StatusMethodNotAllowed, "use GET to list models")
		return
	}
	name := r.URL.Query().Get("name")
	models, err := harness.DiscoverModels(r.Context(), name)
	if err != nil {
		httpx.Fail(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, map[string]any{"models": models})
}

func (s *Server) handleAgentSelect(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	name := r.URL.Query().Get("name")
	model := r.URL.Query().Get("model")
	if err := s.agent.Select(name, model); err != nil {
		code := 400
		if errors.Is(err, errAgentBusy) {
			code = http.StatusConflict
		}
		httpx.Fail(w, code, err.Error())
		return
	}
	httpx.WriteJSON(w, map[string]any{
		"harnesses": s.agent.Detect(),
		"selected":  s.agent.Name(),
		"model":     s.agent.Model(),
		"pinned":    s.agent.Pinned(),
		"settings":  settings.Path(),
	})
}

func (s *Server) handleAgentEdit(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	q := r.URL.Query()
	if q.Get("path") == "" {
		s.handleAgentBatchEdit(w, r)
		return
	}
	abs, rel, ok := s.resolvePath(q.Get("path"))
	if !ok {
		httpx.Fail(w, 400, "bad path")
		return
	}
	l1, _ := strconv.Atoi(q.Get("l1"))
	l2, _ := strconv.Atoi(q.Get("l2"))

	job, err := s.threads.StartEdit([]threads.BatchItem{{Abs: abs, Path: rel, L1: l1, L2: l2, Instruction: q.Get("instruction")}})
	if err != nil {
		code := 400
		if errors.Is(err, errAgentBusy) || errors.Is(err, errAgentDirty) {
			code = http.StatusConflict
		}
		httpx.Fail(w, code, err.Error())
		return
	}
	httpx.WriteJSON(w, job)
}

func (s *Server) handleAgentBatchEdit(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Fail(w, 400, "failed reading body")
		return
	}

	var req struct {
		Edits []struct {
			Path        string `json:"path"`
			L1          int    `json:"l1"`
			L2          int    `json:"l2"`
			Instruction string `json:"instruction"`
		} `json:"edits"`
		Force bool `json:"force"`
	}

	if err := json.Unmarshal(bodyBytes, &req); err != nil || len(req.Edits) == 0 {
		var list []struct {
			Path        string `json:"path"`
			L1          int    `json:"l1"`
			L2          int    `json:"l2"`
			Instruction string `json:"instruction"`
		}
		var single struct {
			Path        string `json:"path"`
			L1          int    `json:"l1"`
			L2          int    `json:"l2"`
			Instruction string `json:"instruction"`
			Force       bool   `json:"force"`
		}
		q := r.URL.Query()
		if err2 := json.Unmarshal(bodyBytes, &list); err2 == nil && len(list) > 0 {
			req.Edits = list
		} else if err3 := json.Unmarshal(bodyBytes, &single); err3 == nil && single.Path != "" {
			req.Edits = []struct {
				Path        string `json:"path"`
				L1          int    `json:"l1"`
				L2          int    `json:"l2"`
				Instruction string `json:"instruction"`
			}{{Path: single.Path, L1: single.L1, L2: single.L2, Instruction: single.Instruction}}
			if single.Force {
				req.Force = true
			}
		} else if qEdits := q.Get("edits"); qEdits != "" {
			if err4 := json.Unmarshal([]byte(qEdits), &req.Edits); err4 != nil || len(req.Edits) == 0 {
				if err5 := json.Unmarshal([]byte(qEdits), &list); err5 == nil && len(list) > 0 {
					req.Edits = list
				}
			}
		} else if q.Get("path") != "" {
			l1, _ := strconv.Atoi(q.Get("l1"))
			l2, _ := strconv.Atoi(q.Get("l2"))
			req.Edits = []struct {
				Path        string `json:"path"`
				L1          int    `json:"l1"`
				L2          int    `json:"l2"`
				Instruction string `json:"instruction"`
			}{{Path: q.Get("path"), L1: l1, L2: l2, Instruction: q.Get("instruction")}}
			if q.Get("force") == "1" {
				req.Force = true
			}
		}

		if len(req.Edits) == 0 {
			httpx.Fail(w, 400, "invalid or empty batch edits payload")
			return
		}
	}

	items := make([]threads.BatchItem, len(req.Edits))
	for i, e := range req.Edits {
		abs, rel, ok := s.resolvePath(e.Path)
		if !ok {
			httpx.Fail(w, 400, fmt.Sprintf("bad path: %s", e.Path))
			return
		}
		items[i] = threads.BatchItem{
			Abs:         abs,
			Path:        rel,
			L1:          e.L1,
			L2:          e.L2,
			Instruction: e.Instruction,
		}
	}

	job, err := s.threads.StartEdit(items)
	if err != nil {
		code := 400
		if errors.Is(err, errAgentBusy) || errors.Is(err, errAgentDirty) {
			code = http.StatusConflict
		}
		httpx.Fail(w, code, err.Error())
		return
	}
	httpx.WriteJSON(w, job)
}

// handleAgentJob is polled while an edit runs, once per in-flight compose box.
// faah dispatched the harness, so it knows when the work ended without
// watching the filesystem for it. id=0 (or missing) means the most recently
// started job.
func (s *Server) handleAgentJob(w http.ResponseWriter, r *http.Request) {
	if !s.agentOrFail(w) {
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	j := s.agent.Job(id)
	if j == nil {
		httpx.WriteJSON(w, map[string]any{"idle": true})
		return
	}
	httpx.WriteJSON(w, j)
}

func (s *Server) handleAgentCancel(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) {
		return
	}
	if !s.agentOrFail(w) {
		return
	}
	id, _ := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if id == 0 {
		var body struct {
			ID int64 `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.ID != 0 {
			id = body.ID
		}
	}
	httpx.WriteJSON(w, map[string]any{"cancelled": s.agent.CancelJob(id)})
}

// Threads are long-running, multi-turn conversations with a coding harness,
// anchored to a range of code but free to read and change anything in the
// workspace. Where an inline edit is a single dispatch that is forgotten once
// it exits, a thread keeps its transcript on disk and continues the same
// harness session on every new message.
//
// Continuity works two ways. A harness with a session id faah can control
// (claude, cursor-agent) resumes its own session, so the harness keeps its own
// context. Every other harness, and any harness switched to mid-thread, is
// replayed the earlier transcript inside the prompt.
//
// There is no overlap guard between threads or against inline edits: two
// harnesses writing the same lines is last write wins.

const (
	threadTurnTimeout = 30 * time.Minute
	threadSnippetMax  = 8000
	threadReplayMax   = 16000
	threadToolsMax    = 200
	threadSaveEvery   = 2 * time.Second
)

var (
	errThreadBusy = errors.New("this thread is still working on a reply")
	errThreadGone = errors.New("no such thread")
)

// threadTurn is one user message and the harness's answer to it.
type threadTurn struct {
	ID        int      `json:"id"`
	Prompt    string   `json:"prompt"`
	Reply     string   `json:"reply"`
	Reasoning string   `json:"reasoning,omitempty"`
	Tools     []string `json:"tools,omitempty"`     // what the harness did, one line each
	Changed   []string `json:"changed,omitempty"`   // files this turn touched
	BeforeSHA string   `json:"beforeSha,omitempty"` // ref-free git snapshot commit before the turn ran
	AfterSHA  string   `json:"afterSha,omitempty"`  // ref-free git snapshot commit after the turn ran
	Reverted  bool     `json:"reverted,omitempty"`  // true if the user reverted this turn's file changes
	Tracked   bool     `json:"tracked"`             // false outside git: Changed is unknown, not empty
	Error     string   `json:"error,omitempty"`
	Running   bool     `json:"running"`
	Harness   string   `json:"harness"`
	Model     string   `json:"model,omitempty"`
	Started   int64    `json:"started"` // unix ms
	Ms        int64    `json:"ms"`
	FirstMs   int64    `json:"firstMs,omitempty"` // until the first words of the reply arrived
	// Refs holds the citations in an explanation's reply that passed checking,
	// by target as written.
	Refs map[string]explain.Ref `json:"refs,omitempty"`
	// What an explanation showed on the code through the explain tools.
	Notes        []notes.Note        `json:"notes,omitempty"`
	Walkthroughs []notes.Walkthrough `json:"walkthroughs,omitempty"`
}

// thread is the persisted conversation. Path and lines are where it was
// started, which is context for the harness and a jump target for the reader,
// not a limit on what it may change.
type thread struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Kind    string `json:"kind,omitempty"` // "edit" or "batch" when started from inline edits; empty for a conversation
	Path    string `json:"path,omitempty"`
	L1      int    `json:"l1,omitempty"`
	L2      int    `json:"l2,omitempty"`
	Snippet string `json:"snippet,omitempty"`
	// Scope is what a PR-review thread is about: "pr" (the whole pull request),
	// "mine" (the reviewer's own changes on top of it) or "selection" (just the
	// anchored code). ScopeSent is the scope the harness was last told, so a
	// change of scope is announced once rather than every turn.
	Scope     string        `json:"scope,omitempty"`
	ScopeSent string        `json:"scopeSent,omitempty"`
	Created   int64         `json:"created"`
	Updated   int64         `json:"updated"`
	SessionID string        `json:"sessionId,omitempty"`
	Turns     []*threadTurn `json:"turns"`
	// An explanation (Kind "explain"). ExplainKey identifies the code it describes
	// and EvidenceHash what surrounded that code; see explain.go. ExplainReader
	// is the explain.reader text it was written for. The packet the harness
	// reads is kept beside the store and loaded here for a turn.
	ExplainKey    string           `json:"explainKey,omitempty"`
	ExplainKind   string           `json:"explainKind,omitempty"`
	ExplainReader string           `json:"explainReader,omitempty"`
	EvidenceHash  string           `json:"evidenceHash,omitempty"`
	Evidence      *explain.Summary `json:"evidence,omitempty"`
	ExplainReq    *explain.Request `json:"explainReq,omitempty"`
	packet        string
}

type threadSummary struct {
	ID      string `json:"id"`
	Kind    string `json:"kind,omitempty"`
	Title   string `json:"title"`
	Path    string `json:"path,omitempty"`
	L1      int    `json:"l1,omitempty"`
	L2      int    `json:"l2,omitempty"`
	Updated int64  `json:"updated"`
	Turns   int    `json:"turns"`
	Running bool   `json:"running"`
	Failed  bool   `json:"failed,omitempty"`
	// Touched: the last finished turn changed files, or could not say (no git),
	// so open tabs need a reload.
	Touched bool `json:"touched,omitempty"`
}

type threadStore struct {
	Root    string    `json:"root"`
	Threads []*thread `json:"threads"`
}

type threadEvent struct {
	name string
	data []byte
}

type threadManager struct {
	agent *agentManager
	root  string
	file  string // empty when there is nowhere to persist

	mu      sync.Mutex
	threads map[string]*thread
	cancels map[string]context.CancelFunc // one running turn per thread
	// prContext, when set (PR review sessions), describes the pull request the
	// workspace is a checkout of; it goes into the first prompt of a thread.
	prContext   func(scope string) string
	jobs        map[int64]*threadJobRef // inline/batch edits, polled as agent jobs
	subs        map[string]map[chan threadEvent]struct{}
	lastSave    time.Time
	sessions    map[string]*threadSession
	sessionIdle time.Duration
	closed      bool
	tools       *explainTools // annotate and walkthrough, for explain turns
	// symbolHash is the callers and references hash of a symbol, set by the
	// server; nil in tests that build a manager alone.
	symbolHash func(rel string, line int, name string) string
}

// threadStorePath keeps every workspace's threads beside settings.json, never
// inside the working tree.
func threadStorePath(root string) string {
	sp := settings.Path()
	if sp == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(root))
	return filepath.Join(filepath.Dir(sp), "threads", hex.EncodeToString(sum[:8])+".json")
}

func newThreadManager(a *agentManager, root string) *threadManager {
	tm := &threadManager{
		agent:    a,
		root:     root,
		file:     threadStorePath(root),
		threads:  map[string]*thread{},
		sessions: map[string]*threadSession{},
		cancels:  map[string]context.CancelFunc{},
		jobs:     map[int64]*threadJobRef{},
		subs:     map[string]map[chan threadEvent]struct{}{},
	}
	tm.tools = newExplainTools(tm)
	tm.load()
	a.BindThreads(tm.job, tm.cancelJob)
	return tm
}

// load restores saved threads. A turn that was running when faah exited can
// never finish, so it is closed out as interrupted rather than left spinning.
func (tm *threadManager) load() {
	if tm.file == "" {
		return
	}
	data, err := os.ReadFile(tm.file)
	if err != nil {
		return
	}
	var st threadStore
	if json.Unmarshal(data, &st) != nil {
		return
	}
	for _, t := range st.Threads {
		if t == nil || t.ID == "" {
			continue
		}
		for _, tr := range t.Turns {
			if tr.Running {
				tr.Running = false
				if tr.Error == "" {
					tr.Error = "interrupted: faah exited before this reply finished"
				}
			}
		}
		tm.threads[t.ID] = t
	}
}

// saveLocked writes the store atomically. Callers hold tm.mu.
func (tm *threadManager) saveLocked() {
	if tm.file == "" {
		return
	}
	st := threadStore{Root: tm.root}
	for _, t := range tm.threads {
		st.Threads = append(st.Threads, t)
	}
	sort.Slice(st.Threads, func(i, j int) bool { return st.Threads[i].Created < st.Threads[j].Created })
	data, err := json.MarshalIndent(st, "", " ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(tm.file), 0o755); err != nil {
		return
	}
	tmp := tm.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, tm.file); err != nil {
		os.Remove(tmp)
		return
	}
	tm.lastSave = time.Now()
}

func newThreadID() string {
	var b [5]byte
	rand.Read(b[:])
	return "t" + hex.EncodeToString(b[:])
}

func threadTitle(msg string) string {
	line := strings.TrimSpace(strings.SplitN(strings.TrimSpace(msg), "\n", 2)[0])
	r := []rune(line)
	if len(r) > 60 {
		line = string(r[:60]) + "…"
	}
	if line == "" {
		line = "Untitled thread"
	}
	return line
}

func (t *thread) running() bool {
	return len(t.Turns) > 0 && t.Turns[len(t.Turns)-1].Running
}

func (t *thread) summary() threadSummary {
	s := threadSummary{ID: t.ID, Kind: t.Kind, Title: t.Title, Path: t.Path, L1: t.L1, L2: t.L2, Updated: t.Updated, Turns: len(t.Turns), Running: t.running()}
	if n := len(t.Turns); n > 0 && !s.Running {
		last := t.Turns[n-1]
		s.Failed = last.Error != ""
		s.Touched = len(last.Changed) > 0 || !last.Tracked
	}
	return s
}

// List returns every thread, most recently active first.
func (tm *threadManager) List() []threadSummary {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	out := make([]threadSummary, 0, len(tm.threads))
	for _, t := range tm.threads {
		out = append(out, t.summary())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out
}

func (tm *threadManager) Get(id string) *thread {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t := tm.threads[id]
	if t == nil {
		return nil
	}
	return cloneThread(t)
}

func cloneThread(t *thread) *thread {
	c := *t
	c.Turns = make([]*threadTurn, len(t.Turns))
	for i, tr := range t.Turns {
		tc := *tr
		tc.Tools = append([]string(nil), tr.Tools...)
		tc.Changed = append([]string(nil), tr.Changed...)
		tc.Notes = append([]notes.Note(nil), tr.Notes...)
		tc.Walkthroughs = append([]notes.Walkthrough(nil), tr.Walkthroughs...)
		c.Turns[i] = &tc
	}
	return &c
}

// Create opens a thread anchored at path:l1-l2 (path may be empty for a thread
// about the workspace as a whole) and starts its first turn.
func (tm *threadManager) Create(abs, rel string, l1, l2 int, message, scope string) (*thread, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("message is empty")
	}
	t := &thread{
		ID:      newThreadID(),
		Title:   threadTitle(message),
		Path:    rel,
		Scope:   cleanThreadScope(scope),
		Created: time.Now().UnixMilli(),
	}
	t.Updated = t.Created
	if rel != "" {
		if l1 < 1 {
			l1 = 1
		}
		if l2 < l1 {
			l2 = l1
		}
		t.L1, t.L2 = l1, l2
		t.Snippet = anchorSnippet(abs, l1, l2)
	}
	tm.mu.Lock()
	tm.threads[t.ID] = t
	tm.mu.Unlock()
	if _, err := tm.Send(t.ID, message); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		return nil, err
	}
	return tm.Get(t.ID), nil
}

func cleanThreadScope(s string) string {
	switch s {
	case "pr", "mine", "selection":
		return s
	}
	return ""
}

// SetScope changes what a thread is about; the harness hears of it with the
// next message.
func (tm *threadManager) SetScope(id, scope string) error {
	scope = cleanThreadScope(scope)
	tm.mu.Lock()
	defer tm.mu.Unlock()
	t := tm.threads[id]
	if t == nil {
		return errThreadGone
	}
	t.Scope = scope
	tm.saveLocked()
	tm.publishThreadLocked(t)
	return nil
}

// threadPrompt composes what the harness is told for one turn. The anchor and
// ground rules go in only when the harness has no memory of them: the first
// turn, or recovery in a new native session.
func threadPrompt(t *thread, prior []*threadTurn, message string, replay bool, prCtx string, scopeChanged bool) string {
	var b strings.Builder
	if len(prior) == 0 || replay {
		if t.Kind == "explain" {
			b.WriteString(explain.Instructions(t.ExplainKind, t.ExplainReader))
			b.WriteString(notes.Prompt())
		} else if t.Kind == "edit" || t.Kind == "batch" {
			b.WriteString("Carry out the edit request below by editing files in place. ")
			b.WriteString("Change only what it asks for; you may touch other files if the change needs it. ")
			b.WriteString("When done, reply in a sentence or two saying what you changed and in which files. ")
			b.WriteString("The user may follow up in this conversation.\n\n")
		} else {
			b.WriteString("You are helping with a long-running conversation about the code in this workspace. ")
			b.WriteString("You may read any file and edit any file needed to carry out what is asked; make edits directly. ")
			b.WriteString("When you finish a request, reply with a concise summary: what you found or changed, and in which files.\n\n")
		}
		if prCtx != "" {
			b.WriteString(prCtx)
			b.WriteString("\n\n")
		}
		if t.Kind == "explain" {
			b.WriteString(t.packet)
			b.WriteString("\n\n")
		} else if t.Path != "" && t.Kind != "batch" { // a batch carries its own snippets
			ext := strings.TrimPrefix(filepath.Ext(t.Path), ".")
			lineStr := fmt.Sprintf("lines %d-%d", t.L1, t.L2)
			if t.L1 == t.L2 {
				lineStr = fmt.Sprintf("line %d", t.L1)
			}
			fmt.Fprintf(&b, "The conversation started at @%s %s (the file may have changed since):\n```%s\n%s\n```\n\n", t.Path, lineStr, ext, t.Snippet)
		}
	}
	if replay && len(prior) > 0 {
		var h strings.Builder
		for _, tr := range prior {
			fmt.Fprintf(&h, "User: %s\n\nAssistant: %s\n\n", tr.Prompt, strings.TrimSpace(tr.Reply))
			if shown := notes.History(tr.Notes, tr.Walkthroughs); shown != "" {
				h.WriteString(shown + "\n")
			}
			if len(tr.Changed) > 0 {
				fmt.Fprintf(&h, "(files changed in that turn: %s)\n\n", strings.Join(tr.Changed, ", "))
			}
		}
		hist := h.String()
		if len(hist) > threadReplayMax {
			hist = "…" + hist[len(hist)-threadReplayMax:]
		}
		b.WriteString("### Earlier in this conversation\n")
		b.WriteString(hist)
		b.WriteString("### Current request\n")
	}
	if scopeChanged && prCtx != "" && len(prior) > 0 && !replay {
		b.WriteString("The user has changed what this conversation is about. ")
		b.WriteString(prCtx)
		b.WriteString("\n\n")
	}
	if t.Kind == "edit" && len(prior) == 0 {
		b.WriteString("### Instruction\n")
	}
	b.WriteString(message)
	return b.String()
}

// threadRun is everything a turn's goroutine needs, decided under the lock.
type threadRun struct {
	tid     string
	turn    *threadTurn
	name    string
	model   string
	base    []string // the selected harness's headless argv
	env     []string // extra environment, such as a read-only agent's config
	message string
	prior   []*threadTurn
}

// Send appends a message to the thread and starts the harness on it.
func (tm *threadManager) Send(id, message string) (*thread, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("message is empty")
	}
	tm.mu.Lock()
	explaining := tm.threads[id] != nil && tm.threads[id].Kind == "explain"
	tm.mu.Unlock()
	name, base, model := tm.agent.current()
	if explaining {
		name, base, model = tm.explainHarness()
	}
	if base == nil {
		ui.Status("err", "thread", "dispatch refused: no coding harness selected", 0, os.Stdout)
		return nil, errAgentNone
	}

	tm.mu.Lock()
	t := tm.threads[id]
	if t == nil {
		tm.mu.Unlock()
		return nil, errThreadGone
	}
	if t.running() {
		tm.mu.Unlock()
		return nil, errThreadBusy
	}
	var env []string
	mode := agents.ModeEdit
	if explaining {
		mode = agents.ModeAsk
	}
	if explaining {
		if err := all.CheckAsk(name); err != nil {
			tm.mu.Unlock()
			return nil, err
		}
	}
	if tm.closed {
		tm.mu.Unlock()
		return nil, errors.New("thread manager is closed")
	}
	if live := tm.sessions[id]; live != nil && live.idle != nil {
		live.idle.Stop()
		live.idle = nil
	}
	if live := tm.sessions[id]; live != nil && (live.name != name || live.model != model || live.mode != mode) {
		tm.closeSessionLocked(id)
	}
	if len(t.Turns) > 0 {
		last := t.Turns[len(t.Turns)-1]
		if last.Harness != name || last.Model != model {
			t.SessionID = ""
		}
	}
	prior := make([]*threadTurn, 0, len(t.Turns))
	for _, tr := range t.Turns {
		c := *tr
		prior = append(prior, &c)
	}
	turn := &threadTurn{
		ID: len(t.Turns) + 1, Prompt: message, Running: true, Tracked: git.Available(tm.root),
		Harness: name, Model: model, Started: time.Now().UnixMilli(),
	}
	t.Turns = append(t.Turns, turn)
	t.Updated = turn.Started
	ctx, cancel := context.WithTimeout(context.Background(), threadTurnTimeout)
	tm.cancels[id] = cancel
	tm.saveLocked()
	tm.publishThreadLocked(t)
	tm.mu.Unlock()

	modelNote := ""
	if model != "" {
		modelNote = " (" + model + ")"
	}
	ui.Status("step", "thread", fmt.Sprintf("%s turn %d · %s%s · %s", id, turn.ID, name, modelNote, t.Title), 0, os.Stdout)

	go tm.runTurn(ctx, cancel, &threadRun{tid: id, turn: turn, name: name, model: model, base: base, env: env, message: message, prior: prior})
	return tm.Get(id), nil
}

func (tm *threadManager) runTurn(ctx context.Context, cancel context.CancelFunc, r *threadRun) {
	defer cancel()

	// Settle the session before composing the prompt: whether the harness
	// remembers the conversation decides whether it must be replayed.
	tm.mu.Lock()
	t := tm.threads[r.tid]
	if t == nil {
		tm.mu.Unlock()
		return
	}
	sessionID := t.SessionID
	explaining := t.Kind == "explain"
	if explaining && t.packet == "" {
		t.packet = tm.readExplainPacket(t.ID)
	}
	tm.mu.Unlock()

	a := tm.agent.openAgent(r.name)
	mode := agents.ModeEdit
	if explaining {
		mode = agents.ModeAsk
	}
	tm.mu.Lock()
	liveSession := tm.sessions[r.tid]
	tm.mu.Unlock()
	stderr := processio.NewTailBuffer(agentLogBytes)
	replay := len(r.prior) > 0 && sessionID == "" && liveSession == nil
	var openErr error
	if liveSession == nil {
		tok := tm.tools.tokens.Issue(toolScope{tid: r.tid})
		o := agents.Open{Key: r.tid, Version: version, Dir: tm.root, Base: r.base, Env: r.env, Model: r.model, Mode: mode, Resume: sessionID, Tools: tm.tools.endpoint(tok), Stderr: stderr}
		var opened agents.Session
		opened, openErr = a.Open(ctx, o)
		if openErr != nil && sessionID != "" {
			o.Resume = ""
			opened, openErr = a.Open(ctx, o)
			replay = true
		}
		if openErr != nil {
			tm.tools.tokens.Revoke(tok)
		} else {
			liveSession = &threadSession{session: opened, token: tok, name: r.name, model: r.model, mode: mode}
			tm.mu.Lock()
			if tm.closed || tm.threads[r.tid] == nil {
				opened.Close()
				tm.tools.tokens.Revoke(tok)
				openErr = errors.New("thread closed")
			} else {
				tm.sessions[r.tid] = liveSession
				t.SessionID = opened.ID()
				tm.saveLocked()
			}
			tm.mu.Unlock()
		}
	}
	if liveSession != nil {
		tm.tools.tokens.Touch(toolScope{tid: r.tid})
	}
	prCtx, scopeChanged := "", false
	if tm.prContext != nil {
		tm.mu.Lock()
		scope := t.Scope
		scopeChanged = scope != t.ScopeSent
		tm.mu.Unlock()
		prCtx = tm.prContext(scope)
		if prCtx != "" {
			tm.mu.Lock()
			t.ScopeSent = scope
			tm.saveLocked()
			tm.mu.Unlock()
		}
	}
	prompt := threadPrompt(t, r.prior, r.message, replay, prCtx, scopeChanged)

	if ui.Verbose {
		ui.VerbosePrompt(0, r.name, prompt, os.Stdout)
	}

	before := threads.WorktreeSnapshot(tm.root)
	beforeSHA := git.SnapshotWorktree(tm.root)
	started := time.Now()
	sink := &threadSink{tm: tm, tid: r.tid, turn: r.turn, began: started}

	var out agents.Outcome
	err := openErr
	if err == nil {
		out, err = liveSession.session.Prompt(ctx, prompt, sink)
	}
	changed := threads.ChangedSince(tm.root, before)
	afterSHA := ""
	if len(changed) > 0 && beforeSHA != "" {
		afterSHA = git.SnapshotWorktree(tm.root)
	}
	tm.agent.Settle(changed)
	var refs map[string]explain.Ref
	if explaining {
		refs = explain.ValidateRefs(tm.root, sink.reply())
	}

	tm.mu.Lock()
	if t := tm.threads[r.tid]; t != nil {
		if t.SessionID == "" && out.SessionID != "" {
			t.SessionID = out.SessionID
		}
		r.turn.Running = false
		r.turn.Ms = time.Since(started).Milliseconds()
		r.turn.Changed = changed
		r.turn.BeforeSHA = beforeSHA
		r.turn.AfterSHA = afterSHA
		r.turn.Refs = refs
		if err != nil {
			msg := err.Error()
			if tail := strings.TrimSpace(stderr.String()); tail != "" && strings.TrimSpace(r.turn.Reply) == "" {
				if len(tail) > 2000 {
					tail = tail[len(tail)-2000:]
				}
				msg += "\n" + tail
			}
			r.turn.Error = msg
		}
		t.Updated = time.Now().UnixMilli()
		if err != nil {
			tm.closeSessionLocked(r.tid)
		}
		tm.idleSessionLocked(r.tid)
		delete(tm.cancels, r.tid)
		tm.saveLocked()
		tm.publishThreadLocked(t)
	}
	tm.mu.Unlock()

	dur := ui.FmtDuration(time.Since(started))
	if err != nil {
		ui.Status("err", "thread", fmt.Sprintf("%s turn %d failed in %s: %s", r.tid, r.turn.ID, dur, err.Error()), 0, os.Stdout)
	} else {
		ui.Status("ok", "thread", fmt.Sprintf("%s turn %d · %s, first words after %s  (%d files changed)", r.tid, r.turn.ID, dur, ui.FmtDuration(time.Duration(r.turn.FirstMs)*time.Millisecond), len(changed)), 0, os.Stdout)
	}
}

// Cancel stops the turn running in a thread. What it already wrote stays.
func (tm *threadManager) Cancel(id string) bool {
	tm.mu.Lock()
	cancel := tm.cancels[id]
	tm.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

// Delete removes a thread, stopping its turn first.
func (tm *threadManager) Delete(id string) bool {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tm.threads[id] == nil {
		return false
	}
	if cancel := tm.cancels[id]; cancel != nil {
		cancel()
	}
	tm.closeSessionLocked(id)
	delete(tm.threads, id)
	tm.removeExplainPacket(id)
	tm.saveLocked()
	tm.publishLocked(id, "deleted", map[string]string{"id": id})
	tm.publishLocked("", "deleted", map[string]string{"id": id})
	return true
}

func (tm *threadManager) Close() {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	for _, cancel := range tm.cancels {
		cancel()
	}
	tm.closed = true
	for id := range tm.sessions {
		tm.closeSessionLocked(id)
	}

}

// RevertTurn restores the files touched by a specific turn back to their
// pre-turn snapshot (BeforeSHA).
func (tm *threadManager) RevertTurn(id string, turnID int) (*thread, []string, error) {
	tm.mu.Lock()
	t := tm.threads[id]
	if t == nil {
		tm.mu.Unlock()
		return nil, nil, errThreadGone
	}
	if t.running() {
		tm.mu.Unlock()
		return nil, nil, errThreadBusy
	}
	var target *threadTurn
	for _, tr := range t.Turns {
		if tr.ID == turnID {
			target = tr
			break
		}
	}
	if target == nil {
		tm.mu.Unlock()
		return nil, nil, errors.New("no such turn")
	}
	if target.BeforeSHA == "" || len(target.Changed) == 0 {
		tm.mu.Unlock()
		return nil, nil, errors.New("no snapshot available for this turn")
	}
	beforeSHA := target.BeforeSHA
	paths := append([]string(nil), target.Changed...)
	tm.mu.Unlock()

	if err := git.RestoreSnapshotPaths(tm.root, beforeSHA, paths); err != nil {
		return nil, nil, err
	}
	tm.agent.Settle(paths)

	tm.mu.Lock()
	if t := tm.threads[id]; t != nil {
		for _, tr := range t.Turns {
			if tr.ID == turnID {
				tr.Reverted = true
				break
			}
		}
		t.Updated = time.Now().UnixMilli()
		tm.saveLocked()
		tm.publishThreadLocked(t)
	}
	tm.mu.Unlock()
	return tm.Get(id), paths, nil
}

// ---------------------------------------------------------------- output

// threadSink receives a turn's output from the agent and keeps it as the
// turn's reply, streaming text and steps to the UI as they arrive.
type threadSink struct {
	tm    *threadManager
	tid   string
	turn  *threadTurn
	began time.Time // when the harness was started, for timing the first words
}

func (s *threadSink) Text(text string, block bool) { s.text(text, block) }
func (s *threadSink) Step(label string) {
	// Agents name files by absolute path; the workspace prefix is noise.
	label = strings.ReplaceAll(label, s.tm.root+string(filepath.Separator), "")
	s.tool(notes.StepLabel(label))
}

// Result is the final answer, kept only when nothing was streamed.
func (s *threadSink) Result(text string) {
	if strings.TrimSpace(s.reply()) == "" {
		s.text(text, true)
	}
}

func (s *threadSink) reply() string {
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	return s.turn.Reply
}

// text appends to the reply. block marks a whole assistant message, which is
// set off from the previous one by a blank line.
func (s *threadSink) text(text string, block bool) {
	if text == "" {
		return
	}
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	if block && s.turn.Reply != "" && !strings.HasSuffix(s.turn.Reply, "\n\n") {
		text = "\n\n" + text
	}
	if s.turn.FirstMs == 0 {
		s.turn.FirstMs = max(1, time.Since(s.began).Milliseconds())
	}
	s.turn.Reply += text
	s.tm.publishLocked(s.tid, "delta", map[string]any{"turn": s.turn.ID, "text": text})
	s.tm.maybeSaveLocked()
}

func (s *threadSink) tool(text string) {
	s.tm.mu.Lock()
	defer s.tm.mu.Unlock()
	if len(s.turn.Tools) < threadToolsMax {
		s.turn.Tools = append(s.turn.Tools, text)
	}
	s.tm.publishLocked(s.tid, "tool", map[string]any{"turn": s.turn.ID, "text": text})
}

// maybeSaveLocked checkpoints a long reply so an exit mid-turn loses seconds,
// not the whole answer.
func (tm *threadManager) maybeSaveLocked() {
	if time.Since(tm.lastSave) >= threadSaveEvery {
		tm.saveLocked()
	}
}

// ---------------------------------------------------------------- events

// publishLocked delivers an event to the subscribers of one thread ("" is the
// list channel). A subscriber that cannot keep up is dropped, and its client
// reconnects to a fresh snapshot, so nothing is ever delivered out of order.
func (tm *threadManager) publishLocked(id, name string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	for ch := range tm.subs[id] {
		select {
		case ch <- threadEvent{name, data}:
		default:
			delete(tm.subs[id], ch)
			close(ch)
		}
	}
}

func (tm *threadManager) publishThreadLocked(t *thread) {
	tm.publishLocked(t.ID, "thread", t)
	tm.publishLocked("", "summary", t.summary())
}

// subscribe registers for events on id ("" for the list) and returns the
// current state taken under the same lock, so nothing falls between the two.
func (tm *threadManager) subscribe(id string) (chan threadEvent, threadEvent, func(), bool) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	var first threadEvent
	if id == "" {
		list := make([]threadSummary, 0, len(tm.threads))
		for _, t := range tm.threads {
			list = append(list, t.summary())
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Updated > list[j].Updated })
		data, _ := json.Marshal(list)
		first = threadEvent{"list", data}
	} else {
		t := tm.threads[id]
		if t == nil {
			return nil, first, nil, false
		}
		data, _ := json.Marshal(t)
		first = threadEvent{"thread", data}
	}
	ch := make(chan threadEvent, 256)
	if tm.subs[id] == nil {
		tm.subs[id] = map[chan threadEvent]struct{}{}
	}
	tm.subs[id][ch] = struct{}{}
	return ch, first, func() {
		tm.mu.Lock()
		defer tm.mu.Unlock()
		if _, ok := tm.subs[id][ch]; ok {
			delete(tm.subs[id], ch)
			close(ch)
		}
	}, true
}

// ---------------------------------------------------------------- HTTP

func (s *Server) threadsOrFail(w http.ResponseWriter) bool {
	if s.threads == nil {
		httpx.Fail(w, http.StatusNotFound, "threads are not available in this session")
		return false
	}
	return true
}

func threadStatus(err error) int {
	switch {
	case errors.Is(err, errThreadBusy), errors.Is(err, errHarnessNotReadOnly):
		return http.StatusConflict
	case errors.Is(err, errThreadGone):
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (s *Server) handleThreads(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	httpx.WriteJSON(w, map[string]any{"threads": s.threads.List()})
}

func (s *Server) handleThreadGet(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	t := s.threads.Get(r.URL.Query().Get("id"))
	if t == nil {
		httpx.Fail(w, http.StatusNotFound, errThreadGone.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadCreate(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		Path    string `json:"path"`
		L1      int    `json:"l1"`
		L2      int    `json:"l2"`
		Message string `json:"message"`
		Scope   string `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	var abs, rel string
	if body.Path != "" {
		var ok bool
		if abs, rel, ok = s.resolvePath(body.Path); !ok {
			httpx.Fail(w, 400, "bad path")
			return
		}
	}
	t, err := s.threads.Create(abs, rel, body.L1, body.L2, body.Message, body.Scope)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadSend(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID      string `json:"id"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	t, err := s.threads.Send(body.ID, body.Message)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, t)
}

func (s *Server) handleThreadCancel(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" && r.Body != nil {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) == nil {
			id = body.ID
		}
	}
	httpx.WriteJSON(w, map[string]any{"cancelled": s.threads.Cancel(id)})
}

func (s *Server) handleThreadScope(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID    string `json:"id"`
		Scope string `json:"scope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.Fail(w, 400, "bad request")
		return
	}
	if err := s.threads.SetScope(body.ID, body.Scope); err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	httpx.WriteJSON(w, s.threads.Get(body.ID))
}

func (s *Server) handleThreadDelete(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" && r.Body != nil {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) == nil {
			id = body.ID
		}
	}
	if id == "" {
		httpx.Fail(w, 400, "missing thread id")
		return
	}
	httpx.WriteJSON(w, map[string]any{"deleted": s.threads.Delete(id)})
}

func (s *Server) handleThreadRevert(w http.ResponseWriter, r *http.Request) {
	if !httpx.LocalPost(w, r) || !s.threadsOrFail(w) {
		return
	}
	var body struct {
		ID   string `json:"id"`
		Turn int    `json:"turn"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" || body.Turn < 1 {
		httpx.Fail(w, http.StatusBadRequest, "id and turn are required")
		return
	}
	t, paths, err := s.threads.RevertTurn(body.ID, body.Turn)
	if err != nil {
		httpx.Fail(w, threadStatus(err), err.Error())
		return
	}
	for _, p := range paths {
		s.ix.TouchPath(p)
	}
	if s.gitWatcher != nil {
		s.gitWatcher.Trigger()
	}
	httpx.WriteJSON(w, map[string]any{"ok": true, "thread": t, "reverted": paths})
}

// handleThreadStream is the SSE feed: one thread's snapshot and live deltas
// with ?id=, or the thread list's changes without it.
func (s *Server) handleThreadStream(w http.ResponseWriter, r *http.Request) {
	if !s.threadsOrFail(w) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}
	ch, first, unsub, ok := s.threads.subscribe(r.URL.Query().Get("id"))
	if !ok {
		httpx.Fail(w, http.StatusNotFound, errThreadGone.Error())
		return
	}
	defer unsub()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	write := func(ev threadEvent) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.name, ev.data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !write(first) {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-s.streamsDone:
			return
		case ev, open := <-ch:
			if !open || !write(ev) {
				return
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ---------------------------------------------------------------- inline edits

// threadJobRef ties an agent-style job id, which the inline and batch edit UI
// polls, to the thread turn doing the work.
type threadJobRef struct {
	tid   string
	turn  int
	items []threads.BatchItem
}

// StartEdit runs inline and batch edits as a thread, so every edit leaves a
// transcript that can be followed up. It keeps the guarantee those flows have
// always had: an edit on lines another edit is still changing is refused.
// Conversations started from the Threads pane are never guarded this way.
func (tm *threadManager) StartEdit(items []threads.BatchItem) (*threads.Job, error) {
	if len(items) == 0 {
		return nil, errors.New("no edits specified")
	}
	for i := range items {
		items[i].Instruction = strings.TrimSpace(items[i].Instruction)
		if items[i].Instruction == "" {
			return nil, errors.New("instruction is empty")
		}
		if items[i].L1 < 1 {
			items[i].L1 = 1
		}
		if items[i].L2 < items[i].L1 {
			items[i].L2 = items[i].L1
		}
		for j := 0; j < i; j++ {
			if items[i].Path == items[j].Path && items[i].L1 <= items[j].L2 && items[j].L1 <= items[i].L2 {
				return nil, fmt.Errorf("overlapping edits in batch on %s (%s and %s)", items[i].Path, lineRef(items[i].L1, items[i].L2), lineRef(items[j].L1, items[j].L2))
			}
		}
	}

	if busy := tm.overlappingEdit(items); busy != "" {
		ui.Status("warn", "agent", "edit dispatch refused: "+busy, 0, os.Stdout)
		return nil, fmt.Errorf("%w: %s", errAgentBusy, busy)
	}

	t := &thread{ID: newThreadID(), Created: time.Now().UnixMilli()}
	t.Updated = t.Created
	var message string
	if len(items) == 1 {
		it := items[0]
		t.Kind, t.Path, t.L1, t.L2 = "edit", it.Path, it.L1, it.L2
		t.Snippet = anchorSnippet(it.Abs, it.L1, it.L2)
		t.Title = "Edit: " + threadTitle(it.Instruction)
		message = it.Instruction
	} else {
		t.Kind, t.Path, t.L1, t.L2 = "batch", items[0].Path, items[0].L1, items[0].L2
		t.Title = fmt.Sprintf("Batch edit: %d changes", len(items))
		var b strings.Builder
		fmt.Fprintf(&b, "Apply these %d edits together.\n\n", len(items))
		for i, it := range items {
			snip, err := threads.ReadLineRange(it.Abs, it.L1, it.L2)
			if err != nil {
				return nil, err
			}
			if len(snip) > threadSnippetMax {
				snip = snip[:threadSnippetMax] + "\n…"
			}
			fmt.Fprintf(&b, "### Edit %d: @%s %s\n```%s\n%s\n```\n%s\n\n", i+1, it.Path, lineRef(it.L1, it.L2),
				strings.TrimPrefix(filepath.Ext(it.Path), "."), snip, it.Instruction)
		}
		message = strings.TrimSpace(b.String())
	}

	tm.mu.Lock()
	tm.threads[t.ID] = t
	tm.mu.Unlock()
	if _, err := tm.Send(t.ID, message); err != nil {
		tm.mu.Lock()
		delete(tm.threads, t.ID)
		tm.mu.Unlock()
		return nil, err
	}
	id := tm.agent.NextJobID()
	tm.mu.Lock()
	tm.jobs[id] = &threadJobRef{tid: t.ID, turn: 1, items: items}
	tm.mu.Unlock()
	return tm.job(id), nil
}

// overlappingEdit describes an edit still running on lines these items touch,
// or returns "" when there is none.
func (tm *threadManager) overlappingEdit(items []threads.BatchItem) string {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	for id, ref := range tm.jobs {
		t := tm.threads[ref.tid]
		if t == nil || !t.running() {
			continue
		}
		for _, run := range ref.items {
			for _, it := range items {
				if run.Path == it.Path && it.L1 <= run.L2 && run.L1 <= it.L2 {
					return fmt.Sprintf("an edit is already running on %s:%s (job #%d with %s)", it.Path, lineRef(it.L1, it.L2), id, t.Turns[len(t.Turns)-1].Harness)
				}
			}
		}
	}
	return ""
}

// job presents an inline or batch edit's turn in the shape the edit UI polls.
// id 0 means the most recent one.
func (tm *threadManager) job(id int64) *threads.Job {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if id == 0 {
		for cand := range tm.jobs {
			if cand > id {
				id = cand
			}
		}
	}
	ref := tm.jobs[id]
	if ref == nil {
		return nil
	}
	t := tm.threads[ref.tid]
	if t == nil || ref.turn > len(t.Turns) {
		return nil
	}
	turn := t.Turns[ref.turn-1]
	j := &threads.Job{
		ID: id, ThreadID: t.ID, Harness: turn.Harness, Path: ref.items[0].Path, Lines: lineRef(ref.items[0].L1, ref.items[0].L2),
		Running: turn.Running, Log: turn.Reply, Stdout: turn.Reply,
		Changed: append([]string{}, turn.Changed...), Ms: turn.Ms, Tracked: turn.Tracked,
	}
	if len(ref.items) > 1 {
		j.BatchCount, j.Items = len(ref.items), ref.items
	}
	if turn.Running {
		j.Ms = time.Now().UnixMilli() - turn.Started
	}
	if turn.Error != "" {
		first, rest, _ := strings.Cut(turn.Error, "\n")
		j.Error, j.Stderr = first, rest
	}
	return j
}

// cancelJob stops the edit with this job id, or every running edit for id 0.
func (tm *threadManager) cancelJob(id int64) bool {
	tm.mu.Lock()
	var tids []string
	for jid, ref := range tm.jobs {
		if id == 0 || jid == id {
			tids = append(tids, ref.tid)
		}
	}
	tm.mu.Unlock()
	cancelled := false
	for _, tid := range tids {
		if tm.Cancel(tid) {
			cancelled = true
		}
	}
	return cancelled
}

func anchorSnippet(abs string, l1, l2 int) string {
	snip, err := threads.ReadLineRange(abs, l1, l2)
	if err != nil {
		return ""
	}
	if len(snip) > threadSnippetMax {
		snip = snip[:threadSnippetMax] + "\n…"
	}
	return snip
}

// Job returns a snapshot of a background or inline edit job.
func (m *agentManager) Job(id int64) *threads.Job {
	if m == nil {
		return nil
	}
	return m.Jobs.Job(id)
}

// Cancel stops every harness currently running. Whatever each has already
// written stays.
func (m *agentManager) Cancel() bool { return m.CancelJob(0) }

// CancelJob stops the harness run with the given id, or every running harness
// when id is 0.
func (m *agentManager) CancelJob(id int64) bool {
	if m == nil {
		return false
	}
	return m.Jobs.CancelJob(id)
}
