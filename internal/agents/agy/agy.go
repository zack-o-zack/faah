// Package agy runs Antigravity's agy CLI.
package agy

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"faah/internal/agents"
	"github.com/px0-ai/harness"
)

const name = "agy"

type Agent struct{}

func New() *Agent { return &Agent{} }

func (*Agent) Name() string      { return name }
func (*Agent) Caps() agents.Caps { return agents.Caps{Sessions: true, NamesSession: true} }

func (*Agent) ReadOnly(argv []string) ([]string, []string, error) {
	out, ok := agents.SetFlag(argv, "--mode", "plan")
	if !ok || !agents.Verified[name] {
		return nil, nil, fmt.Errorf("%s has %w", name, agents.ErrNotReadOnly)
	}
	return out, nil, nil
}

// NewSession returns "": agy names the conversation and reports it.
func (*Agent) NewSession(context.Context, string, []string) string { return "" }

func (a *Agent) Run(ctx context.Context, t agents.Turn, sink agents.Sink) (agents.Outcome, error) {
	return agents.Exec(ctx, name, t, a.TurnArgv(t.Argv, t.SessionID, t.Resume), parse, sink)
}

// TurnArgv adds the session and output flags a turn needs. Flag order does not
// matter to the CLI, so they go right after the binary.
func (*Agent) TurnArgv(argv []string, sessionID string, resume bool) []string {
	extra := []string{"--output-format", "stream-json"}
	if resume && sessionID != "" {
		extra = append(extra, "--conversation", sessionID)
	}
	return agents.InsertAfterBinary(argv, extra)
}

// StdinArgv reads the prompt from stdin as one stream-json message.
func (*Agent) StdinArgv(argv []string) []string {
	return agents.StdinArgv(argv, harness.Placeholder)
}

func (*Agent) StdinMessage(prompt string) []byte {
	b, _ := json.Marshal(map[string]any{"event": "user", "message": map[string]any{"role": "user", "content": prompt}})
	return append(b, '\n')
}

func (*Agent) Stream(sink agents.Sink) *agents.Stream { return agents.NewStream(parse, sink) }

// parse reads one line of `agy --output-format stream-json`.
func parse(line string) []agents.Event {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return nil
	}
	var ev struct {
		Event          string `json:"event"`
		ConversationID string `json:"conversation_id"`
		StepUpdate     *struct {
			StepType string `json:"step_type"`
			State    string `json:"state"`
			ToolName string `json:"tool_name"`
			ToolInfo *struct {
				Name       string          `json:"name"`
				Parameters json.RawMessage `json:"parameters"`
			} `json:"tool_info"`
			TextDelta string `json:"text_delta"`
		} `json:"step_update"`
		Result *struct {
			Status   string `json:"status"`
			Response string `json:"response"`
			Error    string `json:"error"`
		} `json:"result"`
	}
	if json.Unmarshal([]byte(line), &ev) != nil {
		return nil
	}
	var out []agents.Event
	if ev.Event == "init" && ev.ConversationID != "" {
		out = append(out, agents.Event{Kind: agents.EventSession, Text: ev.ConversationID})
	}
	if ev.Event == "step_update" && ev.StepUpdate != nil {
		su := ev.StepUpdate
		switch su.StepType {
		case "tool":
			if su.State == "ACTIVE" || su.State == "" {
				name := su.ToolName
				var params json.RawMessage
				if su.ToolInfo != nil {
					if su.ToolInfo.Name != "" {
						name = su.ToolInfo.Name
					}
					params = su.ToolInfo.Parameters
				}
				out = append(out, agents.Event{Kind: agents.EventTool, Text: agents.ToolLabel(name, params)})
			}
		case "agent_response":
			if su.TextDelta != "" {
				out = append(out, agents.Event{Kind: agents.EventText, Text: su.TextDelta, Block: false})
			}
		}
	}
	if ev.Event == "result" && ev.Result != nil {
		r := ev.Result
		if r.Status != "" && r.Status != "SUCCESS" {
			errText := r.Error
			if errText == "" {
				errText = "the harness reported an error"
			}
			out = append(out, agents.Event{Kind: agents.EventError, Text: errText})
		} else if strings.TrimSpace(r.Response) != "" {
			out = append(out, agents.Event{Kind: agents.EventResult, Text: r.Response})
		}
	}
	return out
}
