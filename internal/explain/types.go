// Package explain builds what an explanation needs: the selection checked
// against the file, the evidence from the workspace, the prompt, and the
// checks on the links in the answer.
package explain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Explain This. A reader selects code and gets a short explanation grounded in
// what the IDE knows. faah gathers the evidence itself, because a harness is a
// separate process with no way to reach the language server, and hands it over
// inside the prompt. The harness runs read-only and only writes the words.

const (
	explainPromptVersion = 1
	explainMaxLines      = 400
	explainMaxFileBytes  = 8 << 20
	PacketMax            = 16 << 10
	explainTargetMax     = 10 << 10
	explainBodyMax       = 6 << 10
	explainDocMax        = 2 << 10
	explainMaxIdents     = 15
	explainMaxIdentTries = 40
	explainMaxCalls      = 12
	explainMaxRefs       = 40
	explainMaxRefsFile   = 8
	explainFallbackLines = 80
	explainSnapLines     = 20
	Budget               = 8 * time.Second
)

// What a symbol turned out to be, and "block" for everything else.
const (
	KindSymbol   = "symbol"
	KindLocal    = "local"
	KindExternal = "external"
	KindBlock    = "block"
)

var (
	ErrBlank    = errors.New("nothing is selected")
	ErrTooLong  = fmt.Errorf("select %d lines or fewer", explainMaxLines)
	ErrMismatch = errors.New("save the file to explain the current code")

	explainIdentRe = regexp.MustCompile(`[\p{L}_$][\p{L}\p{N}_$]*`)
	explainWholeID = regexp.MustCompile(`^[\p{L}_$][\p{L}\p{N}_$]*$`)
	explainTagRe   = regexp.MustCompile(`<[^>]+>`)

	// These three mirror what thrInline turns into links in the client.
	explainMdLinkRe = regexp.MustCompile(`\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)`)
	explainBareRe   = regexp.MustCompile(`(?m)(?:^|[\s(])([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+:\d+(?:-\d+)?)`)
	explainTargetRe = regexp.MustCompile(`^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$`)
)

// Words that are never worth asking a language server about in a block.
var explainKeywords = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(`if else for while do switch case default break continue return func function
		fn def var let const type struct class interface enum import from package new delete try catch finally
		throw defer go range map chan select nil null none true false this self async await static public
		private protected void int string bool float double long char in is not and or`) {
		m[w] = true
	}
	return m
}()

// Request is what the client sends. A diff selection has no columns.
type Request struct {
	Path  string `json:"path"`
	L1    int    `json:"l1"`
	C1    *int   `json:"c1,omitempty"`
	L2    int    `json:"l2"`
	C2    *int   `json:"c2,omitempty"`
	Text  string `json:"text"`
	Force bool   `json:"force,omitempty"`
}

// Target is a selection checked against the file on disk. Name and Col
// are set for a symbol; Col is -1 for a block.
type Target struct {
	Abs, Rel string
	L1, L2   int
	Col      int
	Name     string
	Text     string
}

// Summary is the line of evidence shown under an explanation.
type Summary struct {
	Source      string `json:"source"` // language server name, or "text"
	Definition  bool   `json:"definition,omitempty"`
	Refs        int    `json:"refs,omitempty"`
	RefFiles    int    `json:"refFiles,omitempty"`
	Callers     int    `json:"callers,omitempty"`
	Identifiers int    `json:"identifiers,omitempty"`
}

// Ref is a citation that survived checking; End is set for a range.
type Ref struct {
	Line int `json:"line,omitempty"`
	End  int `json:"end,omitempty"`
}
