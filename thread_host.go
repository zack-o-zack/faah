package main

import (
	"faah/internal/explain"
	"faah/internal/explain/notes"
	"faah/internal/threads"
)

// threadManager composes the thread service with the host's Explain contracts.
type threadManager struct {
	*threads.Manager
	agent      *agentManager
	root, file string
	tools      *explainTools
	// symbolHash is the callers and references hash of a symbol, set by the
	// server; nil in tests that build a manager alone.
	symbolHash func(rel string, line int, name string) string
}

func newThreadManager(a *agentManager, root string) *threadManager {
	return newThreadManagerAt(a, root, threads.StorePath(root))
}

func newThreadManagerAt(a *agentManager, root, file string) *threadManager {
	tm := &threadManager{agent: a, root: root, file: file}
	tm.tools = newExplainTools(tm)
	tm.Manager = threads.New(a.Jobs, root, file, threads.Runtime{
		Select:       tm.explainHarness,
		Instructions: explain.Instructions,
		ToolsPrompt:  notes.Prompt,
		History:      notes.History,
		ValidateRefs: explain.ValidateRefs,
		Issue:        func(id string) string { return tm.tools.tokens.Issue(toolScope{tid: id}) },
		Touch:        func(id string) { tm.tools.tokens.Touch(toolScope{tid: id}) },
		Revoke:       tm.tools.tokens.Revoke,
		RevokeThread: func(id string) {
			tm.tools.tokens.RevokeScope(func(scope any) bool { sc, ok := scope.(toolScope); return ok && sc.tid == id })
		},
		Endpoint: tm.tools.endpoint,
		HashNotes: func(id string, turn, from int, ns []notes.Note) {
			tm.hashNotes(toolScope{tid: id, turn: turn}, from, ns)
		},
	})
	return tm
}
