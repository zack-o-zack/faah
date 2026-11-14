package lsp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"faah/internal/metrics"
)

type state string

const (
	off      state = "off"      // disabled, or no server installed for this type
	Starting state = "starting" // process spawned, handshake in flight
	Indexing state = "indexing" // up, but still chewing through the workspace
	Ready    state = "ready"
	failed   state = "failed"
)

// maxRestarts bounds how often one crashed language server is respawned.
const maxRestarts = 3

// Manager coordinates background language servers across file types and extensions.
// It manages on-demand server lazy starting, discovery, restart on crash, installation jobs,
// and path allowlisting for external references (such as standard library files).
type Manager struct {
	root    string
	version string
	enabled bool

	// mu guards the discovery/registry tables below. It is an RWMutex: the
	// read-heavy paths (defFor, State, Available, serverStatus) take the read
	// lock, and only spawn/discover/Stop mutate. No I/O happens under it.
	mu        sync.RWMutex
	byExt     map[string]*serverDef // resolved by discover(), again on Rescan
	clients   map[string]*client    // server name -> client
	starting  map[string]chan struct{}
	failed    map[string]string
	available []string
	restarts  map[string]int // crashes recovered from, per server name
	stopped   map[string]bool

	discovered bool // the first discover() has finished

	jobMu sync.Mutex
	jobs  map[string]*job // install runs, by server name

	// external holds absolute paths outside the indexed tree that a language
	// server pointed us at. Only these are openable beyond the root, so a
	// jump into the standard library works without opening up the filesystem.
	extMu    sync.RWMutex
	external map[string]bool
}

func (m *Manager) Allow(abs string) {
	m.extMu.Lock()
	if m.external == nil {
		m.external = map[string]bool{}
	}
	if len(m.external) < 20000 {
		m.external[abs] = true
	}
	m.extMu.Unlock()
}

// Allowed reports whether a language server has named this exact file.
func (m *Manager) Allowed(abs string) bool {
	m.extMu.RLock()
	defer m.extMu.RUnlock()
	return m.external[abs]
}

type Options struct {
	Root, Version string
	Enabled       bool
}

// New creates a new language server manager for opts.Root.
// If opts.Enabled is true, server discovery begins in the background without blocking startup.
func New(opts Options) *Manager {
	m := &Manager{
		root: opts.Root, enabled: opts.Enabled, version: opts.Version,
		byExt:    map[string]*serverDef{},
		clients:  map[string]*client{},
		starting: map[string]chan struct{}{},
		failed:   map[string]string{},
		stopped:  map[string]bool{},
	}
	if !opts.Enabled {
		return m
	}
	// Discover available language servers in background so server startup is instantaneous.
	go m.discover()
	return m
}

// discover resolves which registry servers are installed. It can run again
// (Rescan) after something is installed; the result replaces the previous one
// in a single swap, so readers never see a half-built table.
func (m *Manager) discover() {
	// Fresh eyes: an install or rescan may have changed what's on disk, so
	// drop memoized binary resolutions before re-resolving.
	invalidateBinaryCache()
	byExt := map[string]*serverDef{}
	var available []string
	for i := range registry {
		def := registry[i] // a copy: Cmd[0] becomes the resolved path
		bin, ok := cachedLookPath(def.Cmd[0])
		if !ok {
			continue
		}
		def.Cmd = append([]string{bin}, def.Cmd[1:]...)
		claimed := false
		for _, ext := range def.Exts {
			if byExt[ext] == nil {
				byExt[ext] = &def
				claimed = true
			}
		}
		if claimed {
			available = append(available, def.Name)
		}
	}
	m.mu.Lock()
	m.byExt, m.available, m.discovered = byExt, available, true
	m.mu.Unlock()
}

func (m *Manager) isDiscovered() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.discovered
}

// binDirs lists folders installers put binaries in that are often missing
// from PATH, so a server installed from faah, or by hand after faah started, is
// found without restarting the shell faah was launched from.
func binDirs() []string {
	var dirs []string
	add := func(elem ...string) { dirs = append(dirs, filepath.Join(elem...)) }
	if v := os.Getenv("GOBIN"); v != "" {
		add(v)
	}
	for _, p := range filepath.SplitList(os.Getenv("GOPATH")) {
		if p != "" {
			add(p, "bin")
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		add(home, "go", "bin")     // go install, default GOPATH
		add(home, ".cargo", "bin") // rustup, cargo install
		add(home, ".local", "bin") // pipx
		add(home, ".opencode", "bin")
		add(home, ".codex", "bin")
	}
	// npm puts global packages beside its own executable unless the prefix was moved.
	if npm, err := exec.LookPath("npm"); err == nil {
		add(filepath.Dir(npm))
	}
	switch runtime.GOOS {
	case "darwin":
		add("/opt/homebrew/bin")
		add("/usr/local/bin")
		// Homebrew's llvm is keg-only: clangd is installed but never linked.
		add("/opt/homebrew/opt/llvm/bin")
		add("/usr/local/opt/llvm/bin")
	case "windows":
		if v := os.Getenv("APPDATA"); v != "" {
			add(v, "npm")
		}
		if v := os.Getenv("ProgramFiles"); v != "" {
			add(v, "LLVM", "bin")
		}
	}
	return dirs
}

const binDirCacheTTL = 30 * time.Second

type binResolve struct {
	path string
	ok   bool
}

var binDirCache struct {
	sync.RWMutex
	dirs []string
	bins map[string]binResolve // binary name -> resolution, against dirs
	at   time.Time
}

func cachedLookPath(name string) (string, bool) {
	binDirCache.RLock()
	if time.Since(binDirCache.at) < binDirCacheTTL && binDirCache.dirs != nil {
		if r, ok := binDirCache.bins[name]; ok {
			binDirCache.RUnlock()
			return r.path, r.ok
		}
	}
	binDirCache.RUnlock()

	binDirCache.Lock()
	defer binDirCache.Unlock()
	if time.Since(binDirCache.at) >= binDirCacheTTL || binDirCache.dirs == nil {
		binDirCache.dirs = binDirs()
		binDirCache.bins = map[string]binResolve{}
		binDirCache.at = time.Now()
	}
	if r, ok := binDirCache.bins[name]; ok {
		return r.path, r.ok
	}
	p, ok := lookPathIn(name, binDirCache.dirs)
	binDirCache.bins[name] = binResolve{path: p, ok: ok}
	return p, ok
}

func invalidateBinaryCache() {
	binDirCache.Lock()
	binDirCache.dirs = nil
	binDirCache.bins = nil
	binDirCache.at = time.Time{}
	binDirCache.Unlock()
}

func lookPathIn(name string, dirs []string) (string, bool) {
	if p, err := exec.LookPath(name); err == nil {
		return p, true
	}
	for _, d := range dirs {
		if p, err := exec.LookPath(filepath.Join(d, name)); err == nil {
			return p, true
		}
	}
	return "", false
}

func (m *Manager) Available() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.available == nil {
		return []string{}
	}
	cp := make([]string, len(m.available))
	copy(cp, m.available)
	return cp
}

func (m *Manager) Enabled() bool { return m.enabled }

func (m *Manager) MemoryBytes() uint64 {
	m.mu.RLock()
	pids := make([]int, 0, len(m.clients))
	for _, c := range m.clients {
		if c.cmd != nil && c.cmd.Process != nil && c.alive() == nil {
			pids = append(pids, c.cmd.Process.Pid)
		}
	}
	m.mu.RUnlock()

	var total uint64
	for _, pid := range pids {
		total += metrics.ReadRSSForPID(pid)
	}
	return total
}

func (m *Manager) defFor(rel string) *serverDef {
	if !m.enabled {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.byExt[strings.ToLower(filepath.Ext(rel))]
}

func (m *Manager) State(rel string) (state, string) {
	ext := strings.ToLower(filepath.Ext(rel))
	m.mu.RLock()
	stoppedName := ""
	if m.stopped != nil {
		for _, reg := range registryFor(rel) {
			if m.stopped[reg.Name] {
				stoppedName = reg.Name
				break
			}
		}
	}
	enabled := m.enabled
	var def *serverDef
	if enabled {
		def = m.byExt[ext] // defFor without the extra lock round-trip
	}
	discovered := m.discovered
	var c *client
	var why string
	var bad, pending, stopped bool
	if def != nil {
		stopped = m.stopped != nil && m.stopped[def.Name]
		c = m.clients[def.Name]
		why, bad = m.failed[def.Name]
		_, pending = m.starting[def.Name]
	}
	m.mu.RUnlock()

	if stoppedName != "" {
		return off, stoppedName
	}
	if def == nil {
		if enabled && !discovered && len(registryFor(rel)) > 0 {
			return Starting, ""
		}
		return off, ""
	}
	if stopped {
		return off, def.Name
	}
	switch {
	case bad:
		return failed, why
	case pending:
		return Starting, def.Name
	case c == nil:
		return Starting, def.Name // not spawned yet; the next call will
	case c.alive() != nil:
		return failed, def.Name
	case c.busy():
		return Indexing, def.Name
	}
	return Ready, def.Name
}

func (m *Manager) client(ctx context.Context, rel string) (*client, error) {
	def := m.defFor(rel)
	if def == nil {
		return nil, errNoServer
	}
	m.mu.RLock()
	stopped := m.stopped != nil && m.stopped[def.Name]
	m.mu.RUnlock()
	if stopped {
		return nil, errStopped
	}
	for {
		m.mu.RLock()
		why, bad := m.failed[def.Name]
		c, ok := m.clients[def.Name]
		wait, starting := m.starting[def.Name]
		var aliveErr error
		if ok {
			aliveErr = c.alive()
		}
		m.mu.RUnlock()

		if bad {
			return nil, errFailed{why}
		}
		if ok && aliveErr == nil {
			return c, nil
		}
		if starting {
			select {
			case <-wait:
				continue // loop back and pick up the result
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}

		m.mu.Lock()
		if why, bad := m.failed[def.Name]; bad {
			m.mu.Unlock()
			return nil, errFailed{why}
		}
		if c, ok := m.clients[def.Name]; ok {
			err := c.alive()
			if err == nil {
				m.mu.Unlock()
				return c, nil
			}
			if m.restarts == nil {
				m.restarts = map[string]int{}
			}
			if m.restarts[def.Name] >= maxRestarts {
				m.mu.Unlock()
				return nil, err
			}
			m.restarts[def.Name]++
			delete(m.clients, def.Name)
			m.mu.Unlock()
			go c.shutdown()
			continue
		}
		if wait, ok := m.starting[def.Name]; ok {
			m.mu.Unlock()
			select {
			case <-wait:
				continue // loop back and pick up the result
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		m.starting[def.Name] = done
		m.mu.Unlock()

		go m.spawn(def, done)

		select {
		case <-done:
			continue
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func (m *Manager) spawn(def *serverDef, done chan struct{}) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	c := newClient(*def, m.root)
	c.version = m.version
	err := c.start(ctx)

	m.mu.Lock()
	if err != nil {
		m.failed[def.Name] = err.Error()
	} else {
		m.clients[def.Name] = c
	}
	delete(m.starting, def.Name)
	m.mu.Unlock()
	close(done)
}

func (m *Manager) CloseDoc(abs, rel string) {
	def := m.defFor(rel)
	if def == nil {
		return
	}
	m.mu.RLock()
	c := m.clients[def.Name]
	m.mu.RUnlock()
	if c != nil {
		c.closeDoc(abs)
	}
}

func (m *Manager) EnsureOpen(ctx context.Context, abs, rel string) error {
	c, err := m.client(ctx, rel)
	if err != nil {
		return err
	}
	return c.ensureOpen(abs, rel)
}

func (m *Manager) RefreshOpenDocs() {
	m.mu.RLock()
	clients := make([]*client, 0, len(m.clients))
	for _, c := range m.clients {
		clients = append(clients, c)
	}
	m.mu.RUnlock()

	for _, c := range clients {
		c.mu.RLock()
		opened := make([]string, 0, len(c.opened))
		for uri := range c.opened {
			opened = append(opened, uri)
		}
		c.mu.RUnlock()

		for _, uri := range opened {
			abs, err := uriToPath(uri)
			if err != nil {
				continue
			}
			if _, err := os.Stat(abs); os.IsNotExist(err) {
				c.closeDoc(abs)
				continue
			}
			rel, err := filepath.Rel(m.root, abs)
			if err != nil {
				rel = abs
			}
			rel = filepath.ToSlash(rel)
			_ = c.syncDoc(abs, rel)
		}
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	clients := make([]*client, 0, len(m.clients))
	for _, c := range m.clients {
		clients = append(clients, c)
	}
	m.clients = map[string]*client{}
	m.mu.Unlock()
	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.shutdown()
		}()
	}
	wg.Wait()
}

func (m *Manager) ReapIdle(maxIdle time.Duration) {
	if maxIdle <= 0 {
		return
	}
	now := time.Now()
	var idle []*client
	m.mu.Lock()
	for name, c := range m.clients {
		if c == nil || c.busy() {
			continue
		}
		last := time.Unix(0, c.lastUsed.Load())
		if now.Sub(last) >= maxIdle {
			idle = append(idle, c)
			delete(m.clients, name)
		}
	}
	m.mu.Unlock()
	for _, c := range idle {
		go c.shutdown()
	}
}

func (m *Manager) Diagnostics(abs, rel string) []diagnostic {
	def := m.defFor(rel)
	if def == nil {
		return []diagnostic{}
	}
	m.mu.RLock()
	c := m.clients[def.Name]
	m.mu.RUnlock()
	if c == nil || c.alive() != nil {
		return []diagnostic{}
	}
	uri := pathToURI(abs)
	c.mu.RLock()
	list := c.diagnostics[uri]
	out := make([]diagnostic, len(list))
	copy(out, list)
	c.mu.RUnlock()
	return out
}

type errFailed struct{ why string }

func (e errFailed) Error() string { return e.why }

var (
	errNoServer = errFailed{"no language server for this file type"}
	errStopped  = errFailed{"language server stopped"}
)

func (m *Manager) Stop(name string) {
	m.mu.Lock()
	if m.stopped == nil {
		m.stopped = map[string]bool{}
	}
	if name == "" || name == "all" {
		for _, def := range registry {
			m.stopped[def.Name] = true
		}
		clients := make([]*client, 0, len(m.clients))
		for _, c := range m.clients {
			clients = append(clients, c)
		}
		m.clients = map[string]*client{}
		m.mu.Unlock()
		for _, c := range clients {
			c.shutdown()
		}
		return
	}

	m.stopped[name] = true
	c := m.clients[name]
	delete(m.clients, name)
	m.mu.Unlock()
	if c != nil {
		c.shutdown()
	}
}

func (m *Manager) StartServer(name string) error {
	if !m.enabled {
		return fmt.Errorf("lsp disabled")
	}
	m.mu.Lock()
	if m.stopped != nil {
		delete(m.stopped, name)
	}
	if m.failed != nil {
		delete(m.failed, name)
	}
	m.mu.Unlock()

	var targetDef *serverDef
	m.mu.RLock()
	for _, def := range m.byExt {
		if def.Name == name {
			targetDef = def
			break
		}
	}
	m.mu.RUnlock()

	if targetDef == nil {
		for i := range registry {
			if registry[i].Name == name {
				def := registry[i]
				if bin, ok := cachedLookPath(def.Cmd[0]); ok {
					def.Cmd = append([]string{bin}, def.Cmd[1:]...)
					targetDef = &def
				}
				break
			}
		}
	}

	if targetDef == nil {
		return fmt.Errorf("language server %q is not installed", name)
	}

	m.mu.Lock()
	if c, ok := m.clients[name]; ok && c.alive() == nil {
		m.mu.Unlock()
		return nil
	}
	if _, ok := m.starting[name]; ok {
		m.mu.Unlock()
		return nil
	}
	done := make(chan struct{})
	m.starting[name] = done
	m.mu.Unlock()

	go m.spawn(targetDef, done)
	return nil
}

func (m *Manager) AnyRunning() bool {
	m.mu.RLock()
	clients := make([]*client, 0, len(m.clients))
	for _, c := range m.clients {
		clients = append(clients, c)
	}
	starting := len(m.starting) > 0
	m.mu.RUnlock()

	for _, c := range clients {
		if c.alive() == nil {
			return true
		}
	}
	return starting
}

func shortLangName(lang string) string {
	switch lang {
	case "TypeScript and JavaScript":
		return "TS / JS"
	case "TypeScript":
		return "TS"
	case "JavaScript":
		return "JS"
	case "C and C++":
		return "C / C++"
	default:
		return lang
	}
}

func (m *Manager) serverStatus(def *serverDef) map[string]any {
	m.mu.RLock()
	c, ok := m.clients[def.Name]
	_, starting := m.starting[def.Name]
	why, failed := m.failed[def.Name]
	isStopped := m.stopped != nil && m.stopped[def.Name]
	m.mu.RUnlock()

	_, installed := cachedLookPath(def.Cmd[0])

	var opts []map[string]any
	autoIndex := -1
	for i, in := range def.installsFor(runtime.GOOS) {
		_, has := cachedLookPath(in.Cmd[0])
		if in.Auto && has && autoIndex == -1 {
			autoIndex = i
		}
		opts = append(opts, map[string]any{
			"index":   i,
			"cmd":     strings.Join(in.Cmd, " "),
			"auto":    in.Auto,
			"tool":    in.Cmd[0],
			"hasTool": has,
		})
	}

	res := map[string]any{
		"name":      def.Name,
		"lang":      shortLangName(def.Lang),
		"fullLang":  def.Lang,
		"exts":      def.Exts,
		"installed": installed,
		"running":   false,
		"state":     "stopped",
		"options":   opts,
		"autoOpt":   autoIndex,
	}

	if j := m.job(def.Name); j != nil {
		res["job"] = map[string]any{
			"running": j.Running,
			"cmd":     j.Cmd,
			"error":   j.Error,
		}
		if j.Running {
			res["state"] = "installing"
			return res
		}
		if j.Error != "" && !installed {
			res["state"] = "missing"
			res["error"] = j.Error
			return res
		}
	}

	if !installed {
		res["state"] = "missing"
		return res
	}

	if isStopped {
		res["state"] = "stopped"
		return res
	}

	if failed {
		res["state"] = "failed"
		res["error"] = why
		return res
	}

	if starting {
		res["state"] = "starting"
		res["running"] = true
		return res
	}

	if ok && c != nil && c.alive() == nil {
		res["running"] = true
		if c.busy() {
			res["state"] = "indexing"
		} else {
			res["state"] = "ready"
		}
		if c.cmd != nil && c.cmd.Process != nil {
			pid := c.cmd.Process.Pid
			res["pid"] = pid
			res["MemoryBytes"] = metrics.ReadRSSForPID(pid)
		}
		return res
	}

	res["state"] = "stopped"
	return res
}

// RelevantServers returns status for workspace extensions and active servers.
func (m *Manager) RelevantServers(exts []string) []map[string]any {
	if !m.Enabled() {
		return []map[string]any{}
	}
	extMap := map[string]bool{}
	for _, ext := range exts {
		extMap[ext] = true
	}
	seen := map[string]bool{}
	var result []map[string]any

	// 1. Add servers matching extensions present in the workspace
	for i := range registry {
		def := &registry[i]
		matchesExt := false
		for _, ext := range def.Exts {
			if extMap[ext] {
				matchesExt = true
				break
			}
		}
		if matchesExt && !seen[def.Name] {
			seen[def.Name] = true
			result = append(result, m.serverStatus(def))
		}
	}

	// 2. Also include any server that is currently running or starting.
	// Snapshot the names under RLock first: serverStatus takes m.mu.RLock
	// itself, and Go's RWMutex is not reentrant, so holding the lock across
	// the call would deadlock.
	m.mu.RLock()
	var extra []string
	for name := range m.clients {
		if !seen[name] {
			extra = append(extra, name)
		}
	}
	for name := range m.starting {
		if !seen[name] {
			extra = append(extra, name)
		}
	}
	m.mu.RUnlock()
	for _, name := range extra {
		for i := range registry {
			if registry[i].Name == name {
				seen[name] = true
				result = append(result, m.serverStatus(&registry[i]))
				break
			}
		}
	}

	return result
}

// Warm starts the language server for rel, waiting until ready or ctx expires.
func (m *Manager) Warm(ctx context.Context, abs, rel string) error {
	_, err := m.client(ctx, rel)
	return err
}
