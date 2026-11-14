package codeintel

// ExplainRequest is what the client sends. A diff selection has no columns.
type ExplainRequest struct {
	Path  string `json:"path"`
	L1    int    `json:"l1"`
	C1    *int   `json:"c1,omitempty"`
	L2    int    `json:"l2"`
	C2    *int   `json:"c2,omitempty"`
	Text  string `json:"text"`
	Force bool   `json:"force,omitempty"`
}

// EvidenceSummary is the line of evidence shown under an explanation.
type EvidenceSummary struct {
	Source      string `json:"source"` // language server name, or "text"
	Definition  bool   `json:"definition,omitempty"`
	Refs        int    `json:"refs,omitempty"`
	RefFiles    int    `json:"refFiles,omitempty"`
	Callers     int    `json:"callers,omitempty"`
	Identifiers int    `json:"identifiers,omitempty"`
}

// Citation is a citation that survived checking; End is set for a range.
type Citation struct {
	Line int `json:"line,omitempty"`
	End  int `json:"end,omitempty"`
}

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
