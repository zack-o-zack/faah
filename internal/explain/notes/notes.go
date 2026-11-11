// Package notes is what the explain tools show on the code: notes on a
// symbol, a line or a block, and walkthroughs of a flow. It checks each call,
// and finds saved notes again in code that has moved.
package notes

import "faah/internal/explain"

// Note explains one symbol, line or block in place.
type Note struct {
	Kind    string `json:"kind"` // symbol, line or block
	Path    string `json:"path"`
	L1      int    `json:"l1"`
	L2      int    `json:"l2"`
	Symbol  string `json:"symbol,omitempty"`
	Summary string `json:"summary"`
	Detail  string `json:"detail,omitempty"`
	Text    string `json:"text"`           // the lines when saved, to find them again
	Refs    string `json:"refs,omitempty"` // a symbol's callers and references hash when saved
}

// Step is one stop of a walkthrough.
type Step struct {
	Path  string `json:"path"`
	L1    int    `json:"l1"`
	L2    int    `json:"l2"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Text  string `json:"text"`
}

// Walkthrough guides the reader through a flow, one step at a time.
type Walkthrough struct {
	Title string `json:"title"`
	Steps []Step `json:"steps"`
}

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
