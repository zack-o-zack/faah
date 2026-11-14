package lsp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	"faah/internal/processio"
)

// ---------------------------------------------------------------- setup & install

// install is one way to get a language server's binary.
type install struct {
	OS   string   // "darwin", "linux" or "windows"; empty for any
	Cmd  []string // Cmd[0] is the installer, which must be present to use this
	Auto bool     // faah may run it: user-level and non-interactive. Otherwise only shown.
}

func (d serverDef) installsFor(goos string) []install {
	var out []install
	for _, in := range d.Install {
		if in.OS == "" || in.OS == goos {
			out = append(out, in)
		}
	}
	return out
}

func registryFor(rel string) []*serverDef {
	ext := strings.ToLower(filepath.Ext(rel))
	var out []*serverDef
	for i := range registry {
		if slices.Contains(registry[i].Exts, ext) {
			out = append(out, &registry[i])
		}
	}
	return out
}

func (m *Manager) MissingLang(rel string) string {
	if !m.enabled || !m.isDiscovered() || m.defFor(rel) != nil {
		return ""
	}
	if defs := registryFor(rel); len(defs) > 0 {
		return defs[0].Lang
	}
	return ""
}

type setupOption struct {
	Cmd     string `json:"cmd"`
	Auto    bool   `json:"auto"`
	Tool    string `json:"tool"`
	HasTool bool   `json:"hasTool"`
}

type setupServer struct {
	Name    string        `json:"name"`
	Options []setupOption `json:"options"`
	Job     *job          `json:"job,omitempty"`
}

type setup struct {
	Enabled bool          `json:"enabled"`
	Lang    string        `json:"lang"`
	State   string        `json:"state"`
	Server  string        `json:"server"`
	Reason  string        `json:"reason,omitempty"` // why a server failed to start
	Servers []setupServer `json:"servers"`
}

func (m *Manager) Setup(rel string) setup {
	st, srv := m.State(rel)
	s := setup{Enabled: m.enabled, State: string(st), Server: srv, Servers: []setupServer{}}
	if st == failed {
		s.Reason = srv
		if def := m.defFor(rel); def != nil {
			s.Server = def.Name
		}
	}
	dirs := binDirs()
	for _, def := range registryFor(rel) {
		if s.Lang == "" {
			s.Lang = def.Lang
		}
		ss := setupServer{Name: def.Name, Options: []setupOption{}, Job: m.job(def.Name)}
		for _, in := range def.installsFor(runtime.GOOS) {
			_, has := lookPathIn(in.Cmd[0], dirs)
			ss.Options = append(ss.Options, setupOption{
				Cmd: strings.Join(in.Cmd, " "), Auto: in.Auto, Tool: in.Cmd[0], HasTool: has,
			})
		}
		s.Servers = append(s.Servers, ss)
	}
	return s
}

func (m *Manager) Rescan() {
	if !m.enabled {
		return
	}
	m.discover()
	m.mu.Lock()
	m.failed = map[string]string{}
	m.restarts = nil
	m.mu.Unlock()
}

const installTimeout = 15 * time.Minute

type job struct {
	Server  string `json:"server"`
	Cmd     string `json:"cmd"`
	Running bool   `json:"running"`
	Error   string `json:"error,omitempty"`
	Log     string `json:"log"`

	out *processio.TailBuffer
}

func (m *Manager) job(name string) *job {
	m.jobMu.Lock()
	defer m.jobMu.Unlock()
	j := m.jobs[name]
	if j == nil {
		return nil
	}
	cp := *j
	cp.Log = j.out.String()
	return &cp
}

func (m *Manager) Install(name string, option int) (*job, error) {
	if !m.enabled {
		return nil, errors.New("language servers are turned off (-no-lsp)")
	}
	var def *serverDef
	for i := range registry {
		if registry[i].Name == name {
			def = &registry[i]
			break
		}
	}
	if def == nil {
		return nil, fmt.Errorf("unknown language server %q", name)
	}
	opts := def.installsFor(runtime.GOOS)
	if option < 0 || option >= len(opts) {
		return nil, fmt.Errorf("%s has no install option %d on %s", name, option, runtime.GOOS)
	}
	in := opts[option]
	if !in.Auto {
		return nil, fmt.Errorf("faah does not run %q; run it in a terminal", strings.Join(in.Cmd, " "))
	}
	tool, ok := lookPathIn(in.Cmd[0], binDirs())
	if !ok {
		return nil, fmt.Errorf("%s is not installed", in.Cmd[0])
	}

	m.jobMu.Lock()
	if j := m.jobs[name]; j != nil && j.Running {
		m.jobMu.Unlock()
		return m.job(name), nil
	}
	j := &job{Server: name, Cmd: strings.Join(in.Cmd, " "), Running: true, out: processio.NewTailBuffer(16 << 10)}
	if m.jobs == nil {
		m.jobs = map[string]*job{}
	}
	m.jobs[name] = j
	m.jobMu.Unlock()

	go m.runInstall(def, j, tool, in.Cmd[1:])
	return m.job(name), nil
}

func (m *Manager) runInstall(def *serverDef, j *job, tool string, args []string) {
	ctx, cancel := context.WithTimeout(context.Background(), installTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, tool, args...)
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	cmd.Stdout, cmd.Stderr = j.out, j.out

	err := cmd.Run()
	switch {
	case ctx.Err() != nil:
		err = fmt.Errorf("gave up after %s", installTimeout)
	case err == nil:
		m.Rescan()
		invalidateBinaryCache()
		if _, found := lookPathIn(def.Cmd[0], binDirs()); !found {
			err = fmt.Errorf("installed, but %s is not on PATH or in the usual install folders", def.Cmd[0])
		}
	}

	m.jobMu.Lock()
	j.Running = false
	if err != nil {
		j.Error = err.Error()
	}
	m.jobMu.Unlock()
}
