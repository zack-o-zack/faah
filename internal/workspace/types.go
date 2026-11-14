package workspace

import (
	"faah/internal/textutil"
)

// FileMatches groups all search hits found within a single file.
type FileMatches struct {
	Path    string           `json:"path"`    // Workspace-relative path to the file
	Matches []textutil.Match `json:"matches"` // List of snippet matches within this file
}
