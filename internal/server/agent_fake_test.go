package server

import (
	"testing"

	"faah/internal/agents"
	"faah/internal/threads/threadstest"
)

type fakePrompt = threadstest.Prompt
type fakeAgent = threadstest.Agent

var fakeReply = threadstest.Reply
var fakeDelay = threadstest.Delay
var fakeAppend = threadstest.Append
var fakeRecordPrompt = threadstest.RecordPrompt

func fakeAgentServer(t *testing.T, root string, prompt fakePrompt) *Server {
	t.Helper()
	fakeCLI(t, "claude")
	s := agentServer(t, root, "claude")
	a := &fakeAgent{PromptFunc: prompt}
	s.agent.openAgent = func(string) agents.Agent { return a }
	return s
}

var fakeCLI = threadstest.CLI
