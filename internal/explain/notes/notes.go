// Package notes is what the explain tools show on the code: notes on a
// symbol, a line or a block, and walkthroughs of a flow. It checks each call,
// and finds saved notes again in code that has moved.
package notes

import (
	"faah/internal/codeintel"
	"faah/internal/explain"
)

// Note is the shared persisted explanation value.
type Note = codeintel.Note

// Step is the shared persisted explanation value.
type Step = codeintel.Step

// Walkthrough is the shared persisted explanation value.
type Walkthrough = codeintel.Walkthrough

// Reader returns a workspace file's lines, or false when rel is not a
// readable file inside the workspace.
type Reader func(rel string) ([]string, bool)

// DiskReader reads files under root, refusing paths that lead out of it.
func DiskReader(root string) Reader {
	return func(rel string) ([]string, bool) {
		abs, ok := explain.Resolve(root, rel)
		if !ok {
			return nil, false
		}
		lines, err := explain.ReadLines(abs)
		return lines, err == nil
	}
}

// View is a saved note as the editor shows it now.
type View struct {
	Thread string `json:"thread"`
	Turn   int    `json:"turn"`
	Index  int    `json:"index"` // in the turn's notes
	Note
	Stale string `json:"stale,omitempty"` // "text" when its code changed, "refs" when a symbol's uses did
}
