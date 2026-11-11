// Package claude runs Claude Code.
package claude

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"faah/internal/agents"
	"github.com/px0-ai/harness"
)

const name = "claude"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--permission-mode", "plan")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return agents.NewUUID() }

// Run adds session flags only when the turn has a session, as threads did
// before this package: a turn without one runs its argv unchanged.
func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	argv := t.Argv
	if t.SessionID != "" {
		argv = a.TurnArgv(t.Argv, t.SessionID, t.Resume)
	}
	return agents.Exec(ctx, name, t, argv, parse, sink)
}

// TurnArgv adds the session and output flags a turn needs. Flag order does not
// matter to the CLI, so they go right after the binary.
func (*Agent) TurnArgv(argv []string, sessionID string, resume bool) []string {
	extra := []string{"--output-format", "stream-json", "--verbose"}
	if resume {
		extra = append(extra, "--resume", sessionID)
	} else {
		extra = append(extra, "--session-id", sessionID)
	}
	return agents.InsertAfterBinary(argv, extra)
}

// StdinArgv reads the prompt from stdin as one stream-json message.
func (*Agent) StdinArgv(argv []string) []string {
	return agents.StdinArgv(argv, harness.Placeholder)
}

func (*Agent) StdinMessage(prompt string) []byte {
	b, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": prompt}})
	return append(b, '\n')
}

func (*Agent) Stream(sink agents.Sink) *agents.Stream { return agents.NewStream(parse, sink) }

// parse reads one line of `claude --output-format stream-json`.
// Lines that are not events faah cares about, or not JSON at all, yield nothing.
func parse(line string) []agents.Event {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return nil
	}
	var ev struct {
		Type      string `json:"type"`
		Subtype   string `json:"subtype"`
		SessionID string `json:"session_id"`
		IsError   bool   `json:"is_error"`
		Result    string `json:"result"`
		Message   struct {
			Content []struct {
				Type  string          `json:"type"`
				Text  string          `json:"text"`
				Name  string          `json:"name"`
				Input json.RawMessage `json:"input"`
			} `json:"content"`
		} `json:"message"`
	}
	if json.Unmarshal([]byte(line), &ev) != nil {
		return nil
	}
	var out []agents.Event
	if ev.SessionID != "" {
		out = append(out, agents.Event{Kind: agents.EventSession})
	}
	switch ev.Type {
	case "assistant":
		for _, c := range ev.Message.Content {
			switch c.Type {
			case "text":
				if strings.TrimSpace(c.Text) != "" {
					out = append(out, agents.Event{Kind: agents.EventText, Text: c.Text, Block: true})
				}
			case "tool_use":
				out = append(out, agents.Event{Kind: agents.EventTool, Text: agents.ToolLabel(c.Name, c.Input)})
			}
		}
	case "result":
		if ev.IsError {
			msg := strings.TrimSpace(ev.Result)
			if msg == "" {
				msg = "the harness reported an error"
			}
			out = append(out, agents.Event{Kind: agents.EventError, Text: msg})
		} else if strings.TrimSpace(ev.Result) != "" {
			out = append(out, agents.Event{Kind: agents.EventResult, Text: ev.Result})
		}
	}
	return out
}
