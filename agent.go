package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/px0-ai/harness"

	"faah/internal/agents"
	"faah/internal/agents/all"
	"faah/internal/httpx"
	lsppkg "faah/internal/lsp"
	"faah/internal/render"
	"faah/internal/settings"
	"faah/internal/threads"
	"faah/internal/ui"
)

// Agents edit the workspace through native sessions. faah supplies instructions,
// streams their progress, and reloads changed files when each turn ends. The
// harness package provides discovery and model lists; adapters own execution.

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
	errAgentBusy  = threads.ErrEditBusy
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
	case errors.Is(err, threads.ErrBusy), errors.Is(err, errHarnessNotReadOnly):
		return http.StatusConflict
	case errors.Is(err, threads.ErrGone):
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
		httpx.Fail(w, http.StatusNotFound, threads.ErrGone.Error())
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
	ch, first, unsub, ok := s.threads.Subscribe(r.URL.Query().Get("id"))
	if !ok {
		httpx.Fail(w, http.StatusNotFound, threads.ErrGone.Error())
		return
	}
	defer unsub()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	write := func(ev threads.Event) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data); err != nil {
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

// Close stops every job, including when editing was disabled at startup.
func (m *agentManager) Close() {
	if m != nil {
		m.Jobs.Close()
	}
}
