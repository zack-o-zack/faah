package notes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"faah/internal/mcp"
)

// Recorder receives what passed the checks, for the turn that called.
type Recorder interface {
	AddNotes(scope any, notes []Note)
	AddWalkthrough(scope any, w Walkthrough)
}

const annotateDesc = "Show explanations on the code in the reader's editor. One call takes a list of notes; " +
	"each explains one symbol, line, or block where it is. symbol and line notes are drawn on one line; " +
	"block notes cover l1 to l2. Notes that fail a check come back with the reason; send only those again."

const walkthroughDesc = "Guide the reader through a flow across functions or files, one step at a time. " +
	"Each step highlights lines l1 to l2 of a file with a short title and body. Use 2 to 20 steps, in reading order."

var annotateSchema = json.RawMessage(`{"type":"object","required":["notes"],"properties":{"notes":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"object","required":["kind","path","l1","summary"],"properties":{` +
	`"kind":{"type":"string","enum":["symbol","line","block"]},` +
	`"path":{"type":"string","description":"Workspace-relative file path"},` +
	`"l1":{"type":"integer","description":"First line, 1-based; for symbol and line, the line that holds it"},` +
	`"l2":{"type":"integer","description":"Last line of a block, inclusive"},` +
	`"symbol":{"type":"string","description":"The symbol's name, for kind symbol"},` +
	`"summary":{"type":"string","description":"One line, at most 120 characters, shown on the code"},` +
	`"detail":{"type":"string","description":"Optional Markdown shown on hover"}}}}}}`)

var walkthroughSchema = json.RawMessage(`{"type":"object","required":["title","steps"],"properties":{"title":{"type":"string"},"steps":{"type":"array","minItems":2,"maxItems":20,"items":{"type":"object","required":["path","l1","l2","title","body"],"properties":{` +
	`"path":{"type":"string"},"l1":{"type":"integer"},"l2":{"type":"integer"},"title":{"type":"string"},"body":{"type":"string"}}}}}}`)

// Apply runs one tool call: it checks the arguments, records what passed, and
// returns what to tell the agent. An error means nothing was shown.
func Apply(read Reader, rec Recorder, scope any, name string, args json.RawMessage) (string, error) {
	if scope == nil {
		return "", errors.New("no explanation is running")
	}
	switch name {
	case "annotate":
		var in struct {
			Notes []Note `json:"notes"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", fmt.Errorf("arguments: %v", err)
		}
		ok, errs := CheckNotes(read, in.Notes)
		if len(ok) == 0 {
			return "", errors.New(strings.Join(errs, "\n"))
		}
		rec.AddNotes(scope, ok)
		text := fmt.Sprintf("Shown %d of %d notes.", len(ok), len(in.Notes))
		if len(errs) > 0 {
			text += " Not shown:\n" + strings.Join(errs, "\n")
		}
		return text, nil
	case "walkthrough":
		var w Walkthrough
		if err := json.Unmarshal(args, &w); err != nil {
			return "", fmt.Errorf("arguments: %v", err)
		}
		w, err := CheckWalkthrough(read, w)
		if err != nil {
			return "", err
		}
		rec.AddWalkthrough(scope, w)
		return fmt.Sprintf("Shown a walkthrough of %d steps.", len(w.Steps)), nil
	}
	return "", fmt.Errorf("no tool named %s", name)
}

// Tools are annotate and walkthrough, for an mcp.Server.
func Tools(read Reader, rec Recorder) []mcp.Tool {
	call := func(name string) func(context.Context, any, json.RawMessage) (string, error) {
		return func(_ context.Context, scope any, args json.RawMessage) (string, error) {
			return Apply(read, rec, scope, name, args)
		}
	}
	return []mcp.Tool{
		{Name: "annotate", Description: annotateDesc, Schema: annotateSchema, ReadOnly: true, Call: call("annotate")},
		{Name: "walkthrough", Description: walkthroughDesc, Schema: walkthroughSchema, ReadOnly: true, Call: call("walkthrough")},
	}
}

// Prompt tells the agent how to show its explanation over MCP.
func Prompt() string {
	return "faah gives you two tools, annotate and walkthrough. Show your explanation on the code. " +
		"Use annotate for a symbol, a line, or a block; one call can carry many notes, up to a whole file. " +
		"Use walkthrough for behavior that spans several functions or files. Choose what fits the question. " +
		"Text you write outside the tools goes into the conversation beside the code, so keep it short.\n\n"
}

// History writes what a turn showed on the code as text, for a conversation
// replayed to a harness that does not remember it.
func History(ns []Note, ws []Walkthrough) string {
	var b strings.Builder
	if len(ns) > 0 {
		b.WriteString("(notes shown on the code:\n")
		for _, n := range ns {
			fmt.Fprintf(&b, "- %s %s: %s\n", n.Kind, lineRef(n.Path, n.L1, n.L2), n.Summary)
		}
		b.WriteString(")\n")
	}
	for _, w := range ws {
		fmt.Fprintf(&b, "(walkthrough shown, %q:\n", w.Title)
		for i, s := range w.Steps {
			fmt.Fprintf(&b, "%d. %s %s: %s\n", i+1, lineRef(s.Path, s.L1, s.L2), s.Title, s.Body)
		}
		b.WriteString(")\n")
	}
	return b.String()
}

func lineRef(path string, l1, l2 int) string {
	if l2 > l1 {
		return fmt.Sprintf("%s:%d-%d", path, l1, l2)
	}
	return fmt.Sprintf("%s:%d", path, l1)
}
