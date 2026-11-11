// Package acp runs persistent Agent Client Protocol sessions over stdio.
package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/host"
)

type frame struct {
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

// Error returns the native protocol error message.
func (e *rpcError) Error() string { return e.Message }

type session struct {
	o        agents.Open
	id       string
	p        *host.Process
	mu       sync.Mutex
	turn     sync.Mutex
	dispatch sync.Mutex
	pending  map[string]chan frame
	queue    []json.RawMessage
	wake     chan struct{}
	done     chan struct{}
	active   chan struct{}
	failure  error
	next     uint64
}

// Open starts a session using the supplied native ACP command and optional session metadata.
func Open(ctx context.Context, o agents.Open, argv, env []string, meta any) (agents.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	dir, err := filepath.Abs(o.Dir)
	if err != nil {
		return nil, err
	}
	o.Dir = dir
	p, err := host.Start(argv, o.Dir, append(append(os.Environ(), o.Env...), env...), o.Stderr)
	if err != nil {
		return nil, err
	}
	s := &session{o: o, p: p, pending: map[string]chan frame{}, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go s.read()
	ok := false
	defer func() {
		if !ok {
			s.Close()
		}
	}()
	version := o.Version
	if version == "" {
		version = "dev"
	}
	raw, err := s.call(ctx, "initialize", map[string]any{"protocolVersion": 2, "clientCapabilities": map[string]any{"fs": map[string]bool{"readTextFile": false, "writeTextFile": false}, "terminal": false}, "clientInfo": map[string]string{"name": "faah", "title": "faah", "version": version}})
	if err != nil {
		return nil, err
	}
	var init struct {
		ProtocolVersion   int `json:"protocolVersion"`
		AgentCapabilities struct {
			LoadSession     bool `json:"loadSession"`
			MCPCapabilities struct {
				HTTP bool `json:"http"`
			} `json:"mcpCapabilities"`
			SessionCapabilities struct {
				Resume json.RawMessage `json:"resume"`
			} `json:"sessionCapabilities"`
		} `json:"agentCapabilities"`
		AuthMethods []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"authMethods"`
	}
	if err = json.Unmarshal(raw, &init); err != nil {
		return nil, err
	}
	servers := []any{}
	if ep := o.Tools; ep != nil {
		if init.AgentCapabilities.MCPCapabilities.HTTP {
			servers = append(servers, map[string]any{"type": "http", "name": "faah", "url": ep.URL, "headers": []any{map[string]string{"name": "Authorization", "value": ep.Authorization}}})
		} else {
			exe, e := os.Executable()
			if e != nil {
				return nil, e
			}
			servers = append(servers, map[string]any{"name": "faah", "command": exe, "args": []string{"acp-mcp-bridge"}, "env": []any{map[string]string{"name": "FAAH_ACP_MCP_ENDPOINT", "value": ep.URL}, map[string]string{"name": "FAAH_ACP_MCP_AUTHORIZATION", "value": ep.Authorization}}})
		}
	}
	params := map[string]any{"cwd": o.Dir, "mcpServers": servers}
	if meta != nil {
		params["_meta"] = meta
	}
	method := "session/new"
	if o.Resume != "" {
		params["sessionId"] = o.Resume
		if r := init.AgentCapabilities.SessionCapabilities.Resume; len(r) > 0 && string(r) != "null" {
			method = "session/resume"
		} else if init.AgentCapabilities.LoadSession {
			method = "session/load"
		} else {
			return nil, errors.New("agent cannot resume sessions")
		}
	}
	raw, err = s.call(ctx, method, params)
	var authErr *rpcError
	if errors.As(err, &authErr) && (authErr.Code == -32000 || authErr.Code == -32001) && (strings.Contains(strings.ToLower(authErr.Message), "auth") || strings.Contains(strings.ToLower(authErr.Message), "sign in")) {
		for _, auth := range init.AuthMethods {
			if auth.Type != "" && auth.Type != "agent" {
				continue
			}
			if _, err = s.call(ctx, "authenticate", map[string]string{"methodId": auth.ID}); err == nil {
				raw, err = s.call(ctx, method, params)
			}
			break
		}
	}
	if err != nil {
		return nil, err
	}
	var setup struct {
		SessionID     string                                `json:"sessionId"`
		ConfigOptions []struct{ ID, Category, Type string } `json:"configOptions"`
		Models        *struct {
			AvailableModels []struct {
				ModelID string `json:"modelId"`
			} `json:"availableModels"`
		} `json:"models"`
		Modes struct {
			AvailableModes []struct {
				ID string `json:"id"`
			} `json:"availableModes"`
		} `json:"modes"`
	}
	if err = json.Unmarshal(raw, &setup); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.id = setup.SessionID
	if s.id == "" {
		s.id = o.Resume
	}
	s.mu.Unlock()
	if s.id == "" {
		return nil, errors.New("agent returned no session id")
	}
	if o.Resume != "" && s.id != o.Resume {
		return nil, errors.New("agent resumed a different session")
	}
	if o.Model != "" {
		configID := ""
		for _, c := range setup.ConfigOptions {
			if c.Type == "select" && (c.Category == "model" || c.ID == "model") {
				configID = c.ID
				break
			}
		}
		if configID != "" {
			_, err = s.call(ctx, "session/set_config_option", map[string]string{"sessionId": s.id, "configId": configID, "value": o.Model})
		} else if setup.Models != nil {
			_, err = s.call(ctx, "session/set_model", map[string]string{"sessionId": s.id, "modelId": o.Model})
		} else {
			err = errors.New("agent does not advertise model selection")
		}
		if err != nil {
			return nil, err
		}
	}
	if o.Mode == agents.ModeAsk {
		for _, m := range setup.Modes.AvailableModes {
			if m.ID == "default" {
				_, err = s.call(ctx, "session/set_mode", map[string]string{"sessionId": s.id, "modeId": m.ID})
				if err != nil {
					return nil, err
				}
				break
			}
		}
	}
	ok = true
	return s, nil
}

// ID returns the native session identifier.
func (s *session) ID() string { return s.id }

func (s *session) send(v any) error {
	b, err := json.Marshal(v)
	if err == nil {
		_, err = s.p.Write(append(b, '\n'))
	}
	return err
}

func (s *session) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	return s.callStarted(ctx, method, params, nil)
}

func (s *session) callStarted(ctx context.Context, method string, params any, started chan<- struct{}) (json.RawMessage, error) {
	s.mu.Lock()
	s.next++
	id := fmt.Sprint(s.next)
	ch := make(chan frame, 1)
	s.pending[id] = ch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, id); s.mu.Unlock() }()
	err := s.send(map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "method": method, "params": params})
	if started != nil {
		close(started)
	}
	if err != nil {
		return nil, err
	}
	select {
	case f := <-ch:
		if f.Error != nil {
			return nil, f.Error
		}
		return f.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.done:
		s.mu.Lock()
		err := s.failure
		s.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, s.p.Error()
	}
}

func (s *session) read() {
	defer close(s.done)
	for line := range s.p.Lines {
		var f frame
		if json.Unmarshal(line, &f) != nil {
			continue
		}
		if f.Method == "" {
			s.mu.Lock()
			ch := s.pending[string(f.ID)]
			s.mu.Unlock()
			if ch != nil {
				select {
				case ch <- f:
				default:
				}
			}
			continue
		}
		if len(f.ID) > 0 {
			s.answer(f)
			continue
		}
		if f.Method == "session/update" {
			s.mu.Lock()
			if s.active != nil {
				s.queue = append(s.queue, f.Params)
			}
			s.mu.Unlock()
			select {
			case s.wake <- struct{}{}:
			default:
			}
		}
	}
}

func faahTool(name string) bool {
	name = strings.TrimPrefix(name, "Run ")
	return strings.HasPrefix(name, "mcp__faah__") || strings.HasPrefix(name, "mcp_faah_")
}

func (s *session) answer(f frame) {
	response := map[string]any{"jsonrpc": "2.0", "id": f.ID}
	if f.Method != "session/request_permission" {
		response["error"] = &rpcError{-32601, "unsupported request: " + f.Method}
	} else {
		var p struct {
			SessionID string `json:"sessionId"`
			ToolCall  struct {
				Kind     string `json:"kind"`
				Title    string `json:"title"`
				RawInput struct {
					Name string `json:"name"`
				} `json:"rawInput"`
				Locations []struct {
					Path string `json:"path"`
				} `json:"locations"`
			} `json:"toolCall"`
			Options []struct {
				Kind     string `json:"kind"`
				OptionID string `json:"optionId"`
			} `json:"options"`
		}
		json.Unmarshal(f.Params, &p)
		s.mu.Lock()
		allow := p.SessionID == s.id
		s.mu.Unlock()
		if s.o.Mode == agents.ModeAsk {
			k := p.ToolCall.Kind
			faah := s.o.Tools != nil && (faahTool(p.ToolCall.Title) || faahTool(p.ToolCall.RawInput.Name))
			allow = allow && (k == "read" || k == "search" || k == "list" || k == "think" || faah)
		}
		for _, l := range p.ToolCall.Locations {
			if !inside(s.o.Dir, l.Path) {
				allow = false
			}
		}
		kind := "reject_once"
		if allow {
			kind = "allow_once"
		}
		outcome := map[string]any{"outcome": "cancelled"}
		for _, o := range p.Options {
			if o.Kind == kind {
				outcome = map[string]any{"outcome": "selected", "optionId": o.OptionID}
				break
			}
		}
		response["result"] = map[string]any{"outcome": outcome}
	}
	_ = s.send(response)
}

func inside(dir, path string) bool {
	return agents.WithinWorkspace(dir, path)
}

// Prompt streams a turn until the agent answers session/prompt.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	out := agents.Outcome{SessionID: s.id, Live: true}
	s.dispatch.Lock()
	completed := make(chan struct{})
	s.mu.Lock()
	s.active = completed
	s.queue = nil
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.active = nil; s.mu.Unlock() }()
	type result struct {
		raw json.RawMessage
		err error
	}
	resultCh := make(chan result, 1)
	started := make(chan struct{})
	go func() {
		raw, err := s.callStarted(context.Background(), "session/prompt", map[string]any{"sessionId": s.id, "prompt": []any{map[string]string{"type": "text", "text": text}}}, started)
		resultCh <- result{raw, err}
		close(completed)
	}()
	<-started
	s.dispatch.Unlock()
	steps := map[string]bool{}
	last := ""
	had := false
	boundary := false
	drain := func() {
		s.mu.Lock()
		q := s.queue
		s.queue = nil
		s.mu.Unlock()
		for _, raw := range q {
			var p struct {
				SessionID string `json:"sessionId"`
				Update    struct {
					SessionUpdate, MessageID, ToolCallID, Title string
					Content                                     struct{ Type, Text string }
				}
			}
			json.Unmarshal(raw, &p)
			if p.SessionID != s.id {
				continue
			}
			u := p.Update
			switch u.SessionUpdate {
			case "agent_message_chunk":
				if u.Content.Type == "text" && u.Content.Text != "" {
					sink.Text(u.Content.Text, had && (boundary || last != u.MessageID))
					boundary = false
					had = true
					last = u.MessageID
				}
			case "agent_thought_chunk":
				if u.Content.Type == "text" {
					sink.Reasoning(u.Content.Text)
				}
			case "tool_call":
				if !steps[u.ToolCallID] {
					steps[u.ToolCallID] = true
					boundary = true
					sink.Step(u.Title)
				}
			}
		}
	}
	for {
		select {
		case r := <-resultCh:
			drain()
			if r.err != nil {
				return out, r.err
			}
			var stop struct {
				StopReason string `json:"stopReason"`
			}
			if err := json.Unmarshal(r.raw, &stop); err != nil {
				return out, err
			}
			if stop.StopReason == "refusal" || stop.StopReason == "" {
				return out, fmt.Errorf("agent stopped: %s", stop.StopReason)
			}
			return out, nil
		case <-s.wake:
			drain()
		case <-ctx.Done():
			err := s.Interrupt(context.Background())
			if err != nil {
				return out, err
			}
			return out, ctx.Err()
		}
	}
}

// Interrupt waits for cancellation before retiring an unresponsive process.
func (s *session) Interrupt(ctx context.Context) error {
	s.dispatch.Lock()
	s.mu.Lock()
	active := s.active
	s.mu.Unlock()
	if active == nil {
		s.dispatch.Unlock()
		return nil
	}
	err := s.send(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": s.id}})
	s.dispatch.Unlock()
	if err != nil {
		return err
	}

	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	select {
	case <-active:
		return nil
	case <-ctx.Done():
	case <-timer.C:
	}
	err = errors.New("agent did not finish cancelling; its process was stopped")
	s.mu.Lock()
	s.failure = err
	s.mu.Unlock()
	s.Close()
	return err
}

// Close stops the session's process.
func (s *session) Close() error { return s.p.Close() }
