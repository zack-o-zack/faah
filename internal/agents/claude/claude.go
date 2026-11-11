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
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true, Tools: agents.ToolsMCP} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--permission-mode", "plan")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

func (*Agent) NewSession(context.Context, string, []string) string { return agents.NewUUID() }

func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, name, t, a.TurnArgv(t), parse, sink)
}

// TurnArgv adds the flags a turn needs right after the binary, where their
// order does not matter: output and session flags when the turn has a
// session, MCP flags when it has tools. A turn with neither, as threads ran
// before this package, runs its argv unchanged.
func (*Agent) TurnArgv(t agents.Turn) []string {
	var extra []string
	if t.SessionID != "" {
		extra = append(extra, "--output-format", "stream-json", "--verbose")
		if t.Resume {
			extra = append(extra, "--resume", t.SessionID)
		} else {
			extra = append(extra, "--session-id", t.SessionID)
		}
	}
	if t.Tools != nil {
		cfg, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"faah": map[string]any{
			"type": "http", "url": t.Tools.URL, "headers": map[string]string{"Authorization": "Bearer " + t.Tools.Token},
		}}})
		extra = append(extra, "--mcp-config", string(cfg), "--strict-mcp-config",
			"--allowedTools", "mcp__faah__annotate,mcp__faah__walkthrough")
	}
	if extra == nil {
		return t.Argv
	}
	return agents.InsertAfterBinary(t.Argv, extra)
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
