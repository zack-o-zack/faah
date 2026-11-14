package workspace

import (
	"faah/internal/fuzzy"
	"sync"
	"time"
)

// FileEntry represents a single indexed file in the workspace,
// storing its relative path, name, size, and pre-computed lowercase representation
// for fast fuzzy searching.
type FileEntry = fuzzy.Item

// Node represents a file or directory entry in the hierarchical file tree view.
type Node struct {
	Name       string `json:"name"`                 // File or directory name
	Path       string `json:"path"`                 // Slash-separated path relative to workspace root
	Dir        bool   `json:"dir"`                  // True if this node is a directory
	Size       int64  `json:"size"`                 // File size in bytes (0 for directories)
	Ignored    bool   `json:"ignored,omitempty"`    // Matched by .gitignore: listed in tree dimmed, never indexed
	Status     string `json:"status,omitempty"`     // Git working-tree status code: M (modified), A (added), D (deleted), U (untracked), etc.
	Staged     bool   `json:"staged,omitempty"`     // True if the file has staged changes in the git index
	Partial    bool   `json:"partial,omitempty"`    // True if the file was modified again after staging
	Dirty      bool   `json:"dirty,omitempty"`      // For folders: true if any descendant has git changes
	YourStatus string `json:"yourStatus,omitempty"` // PR review mode: reviewer's local changes since checkout
	YourDirty  bool   `json:"yourDirty,omitempty"`  // PR review mode for folders: contains reviewer-changed descendant
}

// vcsDirs are version control internals. Unlike other ignored entries they are
// not even listed: nobody reads them, and .git is present in nearly every repo.
var vcsDirs = map[string]bool{".git": true, ".hg": true, ".svn": true}

// Index maintains in-memory representation of the workspace filesystem:
// a flat list of all unignored files for fast searching, a directory tree map
// for lazy sidebar rendering, and live git status tracking.
type Index struct {
	root string

	mu               sync.RWMutex
	files            []FileEntry
	children         map[string][]Node
	builtAt          time.Time
	buildMS          int64
	gitChanges       int
	gitFiles         []string
	gitStatusMap     map[string]string
	gitStagedMap     map[string]bool
	gitPartialMap    map[string]bool
	gitYourStatusMap map[string]string
	diffBase         string
	prHead           string
	prFiles          map[string]string
	pushedHead       string // PR mode: remote branch tip as of the last push; bounds "unpushed"
	readyCh          chan struct{}
}

// NewIndex constructs a new unpopulated workspace index for the given root directory.
func NewIndex(root string) *Index {
	return &Index{root: root, children: map[string][]Node{}, readyCh: make(chan struct{})}
}

// Root returns the absolute path to the workspace root directory.
func (ix *Index) Root() string { return ix.root }

// Ready reports whether the initial index build has finished.
func (ix *Index) Ready() bool {
	select {
	case <-ix.readyCh:
		return true
	default:
		return false
	}
}

// WaitReady waits up to timeout for the index build to complete.
func (ix *Index) WaitReady(timeout time.Duration) bool {
	select {
	case <-ix.readyCh:
		return true
	case <-time.After(timeout):
		return ix.Ready()
	}
}

// Stats returns the total indexed file count, the timestamp of the build, and duration in milliseconds.
func (ix *Index) Stats() (files int, builtAt time.Time, ms int64) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.files), ix.builtAt, ix.buildMS
}

// Files returns a copy or view of all indexed file entries.
func (ix *Index) Files() []FileEntry {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.files
}
