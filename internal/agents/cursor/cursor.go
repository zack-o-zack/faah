// Package cursor runs Cursor's cursor-agent.
package cursor

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"faah/internal/agents"
)

const name = "cursor-agent"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true} }

// ReadOnly swaps --force for ask mode. It has not passed the conformance
// test yet, so it is refused until cursor-agent is in agents.Verified.
func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out := append([]string(nil), argv...)
	for i, a := range out {
		if a == "--force" && agents.Verified[name] {
			return append(out[:i:i], append([]string{"--mode", "ask"}, out[i+1:]...)...), nil, nil
		}
	}
	return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
}

// NewSession asks cursor-agent for a chat id it will accept on --resume.
func (*Agent) NewSession(ctx context.Context, dir string, argv []string) string {
	bin := argv[0]
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, bin, "create-chat")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	lines := strings.Fields(strings.TrimSpace(string(out)))
	if len(lines) == 0 {
		return ""
	}
	return lines[len(lines)-1]
}

// Run resumes the chat when the turn has one. A cursor session is live after
// a turn that ran in it and did not fail.
func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	out, err := agents.Exec(ctx, name, t, turnArgv(t.Argv, t.SessionID), agents.PlainText, sink)
	out.Live = err == nil && t.SessionID != ""
	return out, err
}

func turnArgv(argv []string, sessionID string) []string {
	if sessionID == "" {
		return argv
	}
	return agents.InsertAfterBinary(argv, []string{"--resume", sessionID})
}
