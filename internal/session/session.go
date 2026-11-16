package session

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"faah/internal/forge"
	"faah/internal/settings"
)

// Tab represents an open editor tab pointing to a file path. Ref, when
// set, is the commit SHA the tab is pinned to -- a tab opened from the
// Unpushed sidebar section, showing that commit's own diff rather than the
// working tree's. A commit that no longer exists simply restores as an
// ordinary tab.
type Tab struct {
	Path string `json:"path"`
	Ref  string `json:"ref,omitempty"`
}

// Workspace stores the persistent UI state for a workspace:
// the list of open tabs, the currently active tab index, expanded directory tree paths,
// and any unsaved PR review comment drafts.
type Workspace struct {
	Tabs     []Tab                `json:"tabs"`
	Active   int                  `json:"active"`
	OpenDirs []string             `json:"openDirs"`
	Drafts   []forge.DraftComment `json:"drafts,omitempty"`
}

// dir returns the directory holding session files: XDG_STATE_HOME/faah/sessions
// if available, falling back to ~/.faah/sessions or os.TempDir()/faah-sessions.
func dir() string {
	if xdg := os.Getenv("XDG_STATE_HOME"); xdg != "" {
		return filepath.Join(xdg, "faah", "sessions")
	}
	if dir := settings.DataDir(); dir != "" {
		return filepath.Join(dir, "sessions")
	}
	return filepath.Join(os.TempDir(), "faah-sessions")
}

// filePath returns the path to the JSON file where workspace session state is saved.
// The file name is derived from the base path or an 8-byte SHA-256 hash of the cleaned
// workspace root path.
func filePath(basePath, root string) string {
	key := ""
	if basePath != "" && basePath != "/" {
		clean := strings.Trim(basePath, "/")
		clean = strings.ReplaceAll(clean, "/", "_")
		key = clean
	} else {
		h := sha256.Sum256([]byte(filepath.Clean(root)))
		key = hex.EncodeToString(h[:8])
	}
	return filepath.Join(dir(), key+".json")
}

// prFilePath returns the session file for a pull request, keyed on the PR
// itself (the workbench item ID) rather than the base path or checkout root. Every
// opening checks the PR out into a new temporary directory, so a root-keyed file
// would never be found again.
func prFilePath(pt forge.PRTarget) string {
	return filepath.Join(dir(), "pr-"+forge.ItemID(pt)+".json")
}

// NewPR opens the session file for a pull request.
func NewPR(pt forge.PRTarget) *Manager {
	sm := &Manager{
		path: prFilePath(pt),
		data: Workspace{Tabs: []Tab{}, OpenDirs: []string{}},
	}
	sm.load()
	return sm
}

// Manager coordinates concurrent thread-safe access and persistence
// for workspace session data on disk.
type Manager struct {
	mu   sync.Mutex
	path string
	data Workspace
}

// New initializes a session manager for the given workspace,
// loading any existing session JSON file from disk.
func New(basePath, root string) *Manager {
	p := filePath(basePath, root)
	sm := &Manager{
		path: p,
		data: Workspace{
			Tabs:     []Tab{},
			OpenDirs: []string{},
		},
	}
	sm.load()
	return sm
}

// load reads the session state from disk into memory, initializing empty slices if nil.
func (sm *Manager) load() {
	if sm.path == "" {
		return
	}
	data, err := os.ReadFile(sm.path)
	if err != nil {
		return
	}
	var s Workspace
	if err := json.Unmarshal(data, &s); err == nil {
		if s.Tabs == nil {
			s.Tabs = []Tab{}
		}
		if s.OpenDirs == nil {
			s.OpenDirs = []string{}
		}
		sm.data = s
	}
}

// Get returns a snapshot of the current workspace session.
func (sm *Manager) Get() Workspace {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.data
}

// Update executes a mutation function on the session state under mutex protection
// and persists the resulting state formatted as JSON to disk.
func (sm *Manager) Update(fn func(*Workspace)) Workspace {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	fn(&sm.data)
	if sm.path != "" {
		if err := os.MkdirAll(filepath.Dir(sm.path), 0o755); err == nil {
			if b, err := json.MarshalIndent(sm.data, "", "  "); err == nil {
				_ = os.WriteFile(sm.path, append(b, '\n'), 0o644)
			}
		}
	}
	return sm.data
}
