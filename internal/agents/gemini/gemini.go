// Package gemini runs Gemini CLI.
package gemini

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"faah/internal/agents"
)

const name = "gemini"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true} }

func (*Agent) ReadOnly([]string) ([]string, []string, error) {
	return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
}

func (*Agent) NewSession(context.Context, string, []string) string { return agents.NewUUID() }

func (*Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	argv := t.Argv
	if t.SessionID != "" {
		argv = turnArgv(t.Argv, t.SessionID, t.Resume)
	}
	return agents.Exec(ctx, name, t, argv, parse, sink)
}

func turnArgv(argv []string, sessionID string, resume bool) []string {
	extra := []string{"--output-format", "stream-json"}
	if resume && sessionID != "" {
		extra = append(extra, "--resume", sessionID)
	} else if sessionID != "" {
		extra = append(extra, "--session-id", sessionID)
	}
	return agents.InsertAfterBinary(argv, extra)
}

// parse reads one line of `gemini --output-format stream-json`.
func parse(line string) []agents.Event {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return nil
	}
	var ev struct {
		Type       string          `json:"type"`
		SessionID  string          `json:"session_id"`
		Role       string          `json:"role"`
		Content    string          `json:"content"`
		Delta      bool            `json:"delta"`
		ToolName   string          `json:"tool_name"`
		Parameters json.RawMessage `json:"parameters"`
		Status     string          `json:"status"`
		Error      string          `json:"error"`
	}
	if json.Unmarshal([]byte(line), &ev) != nil {
		return nil
	}
	var out []agents.Event
	if ev.Type == "init" && ev.SessionID != "" {
		out = append(out, agents.Event{Kind: agents.EventSession, Text: ev.SessionID})
	}
	if ev.Type == "tool_use" {
		out = append(out, agents.Event{Kind: agents.EventTool, Text: agents.ToolLabel(ev.ToolName, ev.Parameters)})
	}
	if ev.Type == "message" && ev.Role == "assistant" && ev.Content != "" {
		out = append(out, agents.Event{Kind: agents.EventText, Text: ev.Content, Block: false})
	}
	if ev.Type == "result" {
		if ev.Status != "" && ev.Status != "success" {
			errText := ev.Error
			if errText == "" {
				errText = "gemini reported an error"
			}
			out = append(out, agents.Event{Kind: agents.EventError, Text: errText})
		}
	}
	return out
}
