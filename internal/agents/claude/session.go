package claude

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/host"
)

type session struct {
	id      string
	mode    agents.Mode
	process *host.Process
	mu      sync.Mutex
	pending map[string]chan frame
	events  chan frame
	done    chan struct{}
	turn    sync.Mutex
}
type content struct {
	Type     string          `json:"type"`
	Text     string          `json:"text"`
	Thinking string          `json:"thinking"`
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
}
type frame struct {
	Type      string `json:"type"`
	RequestID string `json:"request_id"`
	Request   struct {
		Subtype   string          `json:"subtype"`
		ToolName  string          `json:"tool_name"`
		Input     json.RawMessage `json:"input"`
		ToolUseID string          `json:"tool_use_id"`
	} `json:"request"`
	Response struct {
		Subtype   string          `json:"subtype"`
		RequestID string          `json:"request_id"`
		Error     string          `json:"error"`
		Response  json.RawMessage `json:"response"`
	} `json:"response"`
	Message struct {
		ID      string    `json:"id"`
		Content []content `json:"content"`
	} `json:"message"`
	Event struct {
		Type         string  `json:"type"`
		Index        int     `json:"index"`
		ContentBlock content `json:"content_block"`
		Delta        content `json:"delta"`
		Message      struct {
			ID string `json:"id"`
		} `json:"message"`
	} `json:"event"`
	Result  string   `json:"result"`
	IsError bool     `json:"is_error"`
	Errors  []string `json:"errors"`
}

func flag(argv []string, k, v string) []string {
	if strings.HasPrefix(v, "-") && len(v) > 1 {
		return append(argv, k+"="+v)
	}
	return append(argv, k, v)
}
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	argv := append([]string(nil), o.Base...)
	if len(argv) == 0 {
		argv = []string{"claude"}
	}
	argv = append(argv, "--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--permission-prompt-tool", "stdio", "--include-partial-messages")
	id := o.Resume
	if id == "" {
		id = agents.NewUUID()
		argv = flag(argv, "--session-id", id)
	} else {
		argv = flag(argv, "--resume", id)
	}
	mode := "default"
	if o.Mode == agents.ModePlan {
		mode = "plan"
	}
	argv = flag(argv, "--permission-mode", mode)
	if o.Model != "" {
		argv = flag(argv, "--model", o.Model)
	}
	if o.Mode == agents.ModePlan {
		argv = flag(argv, "--tools", "Read,Glob,Grep")
	}
	env := []string{}
	for _, v := range append(os.Environ(), o.Env...) {
		if !strings.HasPrefix(v, "NODE_OPTIONS=") && !strings.HasPrefix(v, "CLAUDE_CODE_ENTRYPOINT=") {
			env = append(env, v)
		}
	}
	env = append(env, "CLAUDE_CODE_ENTRYPOINT=faah")
	p, err := host.Start(argv, o.Dir, env, o.Stderr)
	if err != nil {
		return nil, err
	}
	s := &session{id: id, mode: o.Mode, process: p, pending: map[string]chan frame{}, events: make(chan frame, 256), done: make(chan struct{})}
	go s.read()
	initCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if err = s.control(initCtx, map[string]any{"subtype": "initialize"}); err == nil && o.Tools != nil {
		err = s.control(initCtx, map[string]any{"subtype": "mcp_set_servers", "servers": map[string]any{"faah": map[string]any{"type": "http", "url": o.Tools.URL, "headers": map[string]string{"Authorization": o.Tools.Authorization}, "timeout": 3900000}}})
	}
	if err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *session) ID() string { return s.id }
func (s *session) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.process.Write(append(b, '\n'))
	return err
}
func (s *session) control(ctx context.Context, req any) error {
	id := agents.NewUUID()
	ch := make(chan frame, 1)
	s.mu.Lock()
	s.pending[id] = ch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, id); s.mu.Unlock() }()
	if err := s.send(map[string]any{"type": "control_request", "request_id": id, "request": req}); err != nil {
		return err
	}
	select {
	case f := <-ch:
		if f.Response.Subtype == "error" {
			return errors.New(f.Response.Error)
		}
		var result struct {
			Failed []string `json:"failed"`
		}
		json.Unmarshal(f.Response.Response, &result)
		if len(result.Failed) > 0 {
			return fmt.Errorf("MCP registration failed: %v", result.Failed)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-s.done:
		return s.process.Error()
	}
}
func (s *session) read() {
	defer close(s.events)
	defer close(s.done)
	for line := range s.process.Lines {
		var f frame
		if json.Unmarshal(line, &f) != nil {
			continue
		}
		switch f.Type {
		case "control_response":
			s.mu.Lock()
			ch := s.pending[f.Response.RequestID]
			s.mu.Unlock()
			if ch != nil {
				ch <- f
			}
		case "control_request":
			response := map[string]any{"subtype": "success", "request_id": f.RequestID}
			switch f.Request.Subtype {
			case "can_use_tool":
				name := f.Request.ToolName
				allow := s.mode == agents.ModeEdit || name == "Read" || name == "Glob" || name == "Grep" || strings.HasPrefix(name, "mcp__faah__")
				if allow {
					response["response"] = map[string]any{"behavior": "allow", "updatedInput": f.Request.Input, "toolUseID": f.Request.ToolUseID}
				} else {
					response["response"] = map[string]any{"behavior": "deny", "message": "This session is read-only.", "toolUseID": f.Request.ToolUseID}
				}
			case "elicitation":
				response["response"] = map[string]string{"action": "decline"}
			default:
				response["subtype"] = "error"
				response["error"] = "unsupported control request: " + f.Request.Subtype
			}
			_ = s.send(map[string]any{"type": "control_response", "response": response})
		case "control_cancel_request":
		default:
			s.events <- f
		}
	}
}
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	out := agents.Outcome{SessionID: s.id, Live: true}
	if err := s.send(map[string]any{"type": "user", "message": map[string]string{"role": "user", "content": text}, "parent_tool_use_id": nil}); err != nil {
		return out, err
	}
	streamed := map[int]bool{}
	steps := map[int]bool{}
	for {
		select {
		case <-ctx.Done():
			interruptCtx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = s.Interrupt(interruptCtx)
			cancel()
			// A cancelled turn must not leave frames for the next prompt.
			s.Close()
			return out, ctx.Err()
		case f, ok := <-s.events:
			if !ok {
				return out, s.process.Error()
			}
			switch f.Type {
			case "stream_event":
				switch f.Event.Type {
				case "message_start":
					streamed = map[int]bool{}
					steps = map[int]bool{}
				case "content_block_start":
					if f.Event.ContentBlock.Type == "tool_use" { /* input arrives in the assistant snapshot */
					}
				case "content_block_delta":
					d := f.Event.Delta
					if d.Type == "text_delta" {
						sink.Text(d.Text, false)
						streamed[f.Event.Index] = true
					}
					if d.Type == "thinking_delta" {
						sink.Reasoning(d.Thinking)
						streamed[f.Event.Index] = true
					}
				}
			case "assistant":
				for i, c := range f.Message.Content {
					switch c.Type {
					case "text":
						if !streamed[i] {
							sink.Text(c.Text, true)
						}
					case "thinking":
						if !streamed[i] {
							sink.Reasoning(c.Thinking)
						}
					case "tool_use":
						if !steps[i] {
							sink.Step(agents.ToolLabel(c.Name, c.Input))
							steps[i] = true
						}
					}
				}
				streamed = map[int]bool{}
				steps = map[int]bool{}
			case "result":
				if f.IsError {
					msg := f.Result
					if msg == "" {
						msg = strings.Join(f.Errors, "; ")
					}
					if msg == "" {
						msg = "the agent reported an error"
					}
					return out, errors.New(msg)
				}
				if f.Result != "" {
					sink.Result(f.Result)
				}
				return out, nil
			}
		}
	}
}
func (s *session) Interrupt(ctx context.Context) error {
	return s.control(ctx, map[string]any{"subtype": "interrupt"})
}
func (s *session) Close() error { return s.process.Close() }
