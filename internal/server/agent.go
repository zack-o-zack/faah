package server

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/px0-ai/harness"

	"faah/internal/agents"
	"faah/internal/agents/all"
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
	version   string

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
func newAgentManager(root, flagSpec string, lsp *lsppkg.Manager, version string) (*agentManager, error) {
	m := &agentManager{
		openAgent: all.For,
		version:   version,
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

// detect reports every harness known and whether it is installed right
// now, so a tool installed since startup shows up without a restart.
// Models are only discovered for the currently selected harness to avoid
// executing external commands (such as `agy models`) on startup for unused tools.
func (m *agentManager) detect() []agentHarness {
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

func (m *agentManager) name() string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.selected
}

func (m *agentManager) model() string {
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

func (m *agentManager) isPinned() bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pinned
}

// selectAgent remembers a harness for this workspace and every later run. Passing an
// empty name turns editing back off.
func (m *agentManager) selectAgent(name string, modelOpt ...string) error {
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

// job returns a snapshot of a background or inline edit job.
func (m *agentManager) job(id int64) *threads.Job {
	if m == nil {
		return nil
	}
	return m.Jobs.Job(id)
}

// cancel stops every harness currently running. Whatever each has already
// written stays.
func (m *agentManager) cancel() bool { return m.cancelJob(0) }

// cancelJob stops the harness run with the given id, or every running harness
// when id is 0.
func (m *agentManager) cancelJob(id int64) bool {
	if m == nil {
		return false
	}
	return m.Jobs.CancelJob(id)
}

// close stops every job, including when editing was disabled at startup.
func (m *agentManager) close() {
	if m != nil {
		m.Jobs.Close()
	}
}
