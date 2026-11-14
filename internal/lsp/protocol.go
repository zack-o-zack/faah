package lsp

import (
	"encoding/json"
	"fmt"
)

// A minimal LSP client: enough of the protocol to answer navigation questions
// (definition, references, document symbols) and nothing else. Everything is
// best-effort — if a server is missing, slow, or broken, callers fall back to
// the regex index, which is always available.

// ---------------------------------------------------------------- protocol

type position struct {
	Line      int `json:"line"`      // 0-based
	Character int `json:"character"` // 0-based, in the negotiated encoding
}

type rangePosition struct {
	Start position `json:"start"`
	End   position `json:"end"`
}

type location struct {
	URI   string        `json:"uri"`
	Range rangePosition `json:"range"`
}

type documentSymbol struct {
	Name           string           `json:"name"`
	Kind           int              `json:"kind"`
	Range          rangePosition    `json:"range"`
	SelectionRange rangePosition    `json:"selectionRange"`
	Children       []documentSymbol `json:"children"`
	// Location carries flat SymbolInformation responses from non-hierarchical servers.
	Location *location `json:"location"`
}

// Kind numbers come from the LSP spec; we only need display names.
var symbolKind = map[int]string{
	1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class",
	6: "method", 7: "property", 8: "field", 9: "ctor", 10: "enum",
	11: "interface", 12: "func", 13: "var", 14: "const", 15: "string",
	16: "number", 17: "bool", 18: "array", 19: "object", 20: "key",
	21: "null", 22: "enum", 23: "struct", 24: "event", 25: "operator",
	26: "type",
}

// Diagnostic represents a single compiler/linter diagnostic reported by a
// language server via textDocument/publishDiagnostics.
type Diagnostic struct {
	Line     int    `json:"line"`              // 1-based start line
	EndLine  int    `json:"endLine,omitempty"` // 1-based end line
	Col      int    `json:"col"`               // 0-based start character
	EndCol   int    `json:"endCol,omitempty"`  // 0-based end character
	Severity int    `json:"severity"`          // 1=Error, 2=Warning, 3=Info, 4=Hint
	Message  string `json:"message"`
	Source   string `json:"source,omitempty"`
	Code     string `json:"code,omitempty"`
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("lsp error %d: %s", e.Code, e.Message) }
