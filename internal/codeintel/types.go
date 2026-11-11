// Package codeintel holds the plain data faah's language-server and search
// code produce, so packages outside main can use it.
package codeintel

// NavHit is one navigation result, shaped exactly like a search Match so the
// UI renders LSP answers and regex answers with the same code.
type NavHit struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Pre  string `json:"pre"`
	Mid  string `json:"mid"`
	Post string `json:"post"`
	Def  bool   `json:"def,omitempty"`
	Ext  bool   `json:"ext,omitempty"` // outside the indexed tree, e.g. stdlib
}

// HoverInfo is what the UI shows in the hover card: a syntax-highlighted
// signature and whatever documentation the server attached to it.
type HoverInfo struct {
	Signature string `json:"signature"` // pre-highlighted HTML, one line per entry
	Doc       string `json:"doc"`
	Empty     bool   `json:"empty"`
}

// CallNode is one function in a call trail.
type CallNode struct {
	Name     string `json:"name"`
	Detail   string `json:"detail,omitempty"`
	Kind     string `json:"kind"`
	Path     string `json:"path"` // where the function is declared
	Line     int    `json:"line"`
	Ext      bool   `json:"ext,omitempty"`
	SitePath string `json:"sitePath,omitempty"` // file holding the call expressions
	Sites    []int  `json:"sites,omitempty"`    // lines of those calls, ascending
	Item     string `json:"item"`               // CallHierarchyItem, returned as-is to expand
}

// Match carries the hit already split into the text before it, the matched
// text, and the text after. Sending offsets instead would force the client to
// reconcile Go byte indexes with UTF-16 string indexes, and would not survive
// the snipping we do to keep long lines readable in a narrow panel.
type Match struct {
	Line int    `json:"line"` // 1-based
	Pre  string `json:"pre"`
	Mid  string `json:"mid"`
	Post string `json:"post"`
	Def  bool   `json:"def,omitempty"` // line looks like a declaration
}

// FileMatches groups all search hits found within a single file.
type FileMatches struct {
	Path    string  `json:"path"`    // Workspace-relative path to the file
	Matches []Match `json:"matches"` // List of snippet matches within this file
}
