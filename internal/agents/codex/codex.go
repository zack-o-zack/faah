// Package codex runs persistent Codex app-server conversations.
package codex

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

// Agent multiplexes conversations over faah's shared app-server.
type Agent struct{}

// New returns the native Codex adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return "codex" }

const serverIdle = 30 * time.Second

var shared struct {
	sync.Mutex
	servers map[string]*sharedServer
}

type sharedServer struct {
	server *server
	refs   int
	idle   *time.Timer
}

func serverKey(o agents.Open) string { b, _ := json.Marshal(launchArgs(o.Base)); return string(b) }

func sharedFor(o agents.Open) *sharedServer {
	if shared.servers == nil {
		shared.servers = map[string]*sharedServer{}
	}
	key := serverKey(o)
	if shared.servers[key] == nil {
		shared.servers[key] = &sharedServer{}
	}
	return shared.servers[key]
}

type envelope struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Error returns the native protocol error message.
func (e *rpcError) Error() string { return e.Message }

type server struct {
	process *host.Process
	mu      sync.Mutex
	next    uint64
	pending map[string]chan envelope
	routes  map[string]*session
	done    chan struct{}
}

func launch(ctx context.Context, o agents.Open) (*server, error) {
	argv := launchArgs(o.Base)
	p, err := host.Start(argv, o.Dir, append(os.Environ(), o.Env...), o.Stderr)
	if err != nil {
		return nil, err
	}
	s := &server{process: p, pending: map[string]chan envelope{}, routes: map[string]*session{}, done: make(chan struct{})}
	go s.read()
	version := o.Version
	if version == "" {
		version = "dev"
	}
	_, err = s.call(ctx, "initialize", map[string]any{"clientInfo": map[string]string{"name": "faah", "title": "faah", "version": version}, "capabilities": map[string]bool{"experimentalApi": true}})
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "already initialized") {
		p.Close()
		return nil, err
	}
	if err = s.send(map[string]any{"method": "initialized"}); err != nil {
		p.Close()
		return nil, err
	}
	return s, nil
}

func launchArgs(base []string) []string {
	if len(base) == 0 {
		base = []string{"codex"}
	}
	return append(append([]string(nil), base...), "app-server")
}

func (s *server) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.process.Write(append(b, '\n'))
	return err
}

func (s *server) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	s.mu.Lock()
	s.next++
	id := s.next
	key := fmt.Sprint(id)
	ch := make(chan envelope, 1)
	s.pending[key] = ch
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, key); s.mu.Unlock() }()
	if err := s.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
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
		return nil, s.process.Error()
	}
}

func (s *server) read() {
	defer close(s.done)
	for line := range s.process.Lines {
		var f envelope
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
		var p struct {
			ThreadID       string `json:"threadId"`
			ConversationID string `json:"conversationId"`
		}
		json.Unmarshal(f.Params, &p)
		if p.ThreadID == "" {
			p.ThreadID = p.ConversationID
		}
		s.mu.Lock()
		session := s.routes[p.ThreadID]
		s.mu.Unlock()
		if len(f.ID) > 0 {
			s.answer(f, session)
			continue
		}
		if session != nil {
			session.enqueue(f)
		}
	}
}

func (s *server) answer(f envelope, session *session) {
	edit := session != nil && session.o.Mode == agents.ModeEdit
	decision := "decline"
	if edit {
		decision = "accept"
	}
	var result any
	switch f.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		result = map[string]any{"decision": decision}
	case "execCommandApproval", "applyPatchApproval":
		var d any = map[string]any{"denied": map[string]string{"rejection": "This session is read-only."}}
		if edit {
			d = "approved"
		}
		result = map[string]any{"decision": d}
	case "item/permissions/requestApproval":
		permissions := json.RawMessage(`{}`)
		if edit {
			var p struct {
				Permissions json.RawMessage `json:"permissions"`
			}
			json.Unmarshal(f.Params, &p)
			if len(p.Permissions) > 0 {
				permissions = p.Permissions
			}
		}
		result = map[string]any{"permissions": permissions, "scope": "turn"}
	case "mcpServer/elicitation/request":
		result = map[string]any{"action": "decline"}
	case "item/tool/requestUserInput":
		result = map[string]any{"answers": map[string]any{}}
	default:
		_ = s.send(map[string]any{"id": f.ID, "error": rpcError{Code: -32601, Message: "unsupported request: " + f.Method}})
		return
	}
	_ = s.send(map[string]any{"id": f.ID, "result": result})
}

type session struct {
	o         agents.Open
	id        string
	model     string
	mu        sync.Mutex
	server    *server
	queue     []envelope
	wake      chan struct{}
	closed    chan struct{}
	turnID    string
	turnReady chan struct{}
	turn      sync.Mutex
	once      sync.Once
}

// Open starts or resumes a conversation on the shared process.
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	s := &session{o: o, id: o.Resume, wake: make(chan struct{}, 1), closed: make(chan struct{})}
	shared.Lock()
	defer shared.Unlock()
	pool := sharedFor(o)
	if pool.idle != nil {
		pool.idle.Stop()
		pool.idle = nil
	}
	if err := s.connect(ctx); err != nil {
		scheduleIdle(pool)
		return nil, err
	}
	pool.refs++
	return s, nil
}

// connect runs under the shared lock; native ids survive process restarts.
func (s *session) connect(ctx context.Context) error {
	pool := sharedFor(s.o)
	if pool.server != nil {
		select {
		case <-pool.server.done:
			pool.server = nil
		default:
		}
	}
	if pool.server == nil {
		srv, err := launch(ctx, s.o)
		if err != nil {
			return err
		}
		pool.server = srv
	}
	srv := pool.server
	s.mu.Lock()
	same := s.server == srv
	s.mu.Unlock()
	if same {
		return nil
	}
	params := map[string]any{"cwd": s.o.Dir, "config": map[string]any{}}
	if s.o.Model != "" {
		params["model"] = s.o.Model
	}
	if ep := s.o.Tools; ep != nil {
		params["config"] = map[string]any{"mcp_servers.faah": map[string]any{"url": ep.URL, "tool_timeout_sec": 3900, "http_headers": map[string]string{"Authorization": ep.Authorization}, "omit_tools_from": []string{"code_mode", "deferred"}}, "mcp_optional_startup_grace_ms": 10000}
	}
	if s.o.Mode == agents.ModePlan {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		params["config"].(map[string]any)["permissions.faah-plan"] = map[string]any{"extends": ":read-only", "filesystem": map[string]string{filepath.Join(home, ".codex", "rules"): "deny"}}
		params["permissions"] = "faah-plan"
		params["approvalPolicy"] = "untrusted"
	}
	method := "thread/start"
	if s.id != "" {
		method = "thread/resume"
		params["threadId"] = s.id
		params["excludeTurns"] = true
	}
	result, err := srv.call(ctx, method, params)
	if err != nil && s.id != "" && strings.Contains(strings.ToLower(err.Error()), "archiv") {
		if _, unarchiveErr := srv.call(ctx, "thread/unarchive", map[string]string{"threadId": s.id}); unarchiveErr == nil {
			result, err = srv.call(ctx, method, params)
		}
	}
	if err != nil {
		return err
	}
	var r struct {
		Model  string `json:"model"`
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err = json.Unmarshal(result, &r); err != nil {
		return err
	}
	if r.Thread.ID == "" {
		return errors.New("codex returned no thread id")
	}
	if s.id == "" {
		s.id = r.Thread.ID
	} else if s.id != r.Thread.ID {
		return errors.New("codex resumed a different thread")
	}
	s.mu.Lock()
	s.server = srv
	s.model = s.o.Model
	if s.model == "" {
		s.model = r.Model
	}
	s.queue = nil
	s.mu.Unlock()
	srv.mu.Lock()
	srv.routes[s.id] = s
	srv.mu.Unlock()
	return nil
}

// ID returns the native thread identifier.
func (s *session) ID() string { return s.id }

func (s *session) enqueue(f envelope) {
	s.mu.Lock()
	if f.Method == "turn/started" && s.turnReady != nil {
		var params struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		}
		if json.Unmarshal(f.Params, &params) == nil && params.Turn.ID != "" {
			s.turnID = params.Turn.ID
			select {
			case <-s.turnReady:
			default:
				close(s.turnReady)
			}
		}
	}
	s.queue = append(s.queue, f)
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Prompt streams one turn, ending only at the matching completion event.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	out := agents.Outcome{SessionID: s.id, Live: true}
	select {
	case <-s.closed:
		return out, errors.New("codex session is closed")
	default:
	}
	shared.Lock()
	err := s.connect(ctx)
	shared.Unlock()
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	select {
	case <-s.closed:
		s.mu.Unlock()
		return out, errors.New("codex session is closed")
	default:
	}
	srv := s.server
	s.queue = nil
	s.turnID = ""
	ready := make(chan struct{})
	s.turnReady = ready
	s.mu.Unlock()
	startCtx, cancelStart := context.WithCancel(context.Background())
	defer func() {
		closed := false
		select {
		case <-s.closed:
			closed = true
		default:
		}
		if ctx.Err() != nil || closed {
			interruptCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = s.Interrupt(interruptCtx)
			cancel()
		}
		cancelStart()
		s.mu.Lock()
		s.turnID = ""
		s.turnReady = nil
		s.mu.Unlock()
	}()
	params := map[string]any{"threadId": s.id, "cwd": s.o.Dir, "input": []any{map[string]string{"type": "text", "text": text}}, "approvalPolicy": "on-request", "sandboxPolicy": map[string]string{"type": "workspaceWrite"}}
	if s.o.Model != "" {
		params["model"] = s.o.Model
	}
	mode := "default"
	if s.o.Mode == agents.ModePlan {
		mode = "plan"
	}
	params["collaborationMode"] = map[string]any{"mode": mode, "settings": map[string]any{"model": s.model}}
	if s.o.Mode == agents.ModePlan {
		params["approvalPolicy"] = "untrusted"
		delete(params, "sandboxPolicy")
		params["permissions"] = "faah-plan"
	}
	started := make(chan error, 1)
	go func() {
		result, err := srv.call(startCtx, "turn/start", params)
		var response struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		}
		if err == nil {
			err = json.Unmarshal(result, &response)
		}
		s.mu.Lock()
		if s.turnReady == ready {
			if response.Turn.ID != "" {
				s.turnID = response.Turn.ID
			}
			select {
			case <-ready:
			default:
				close(ready)
			}
		}
		s.mu.Unlock()
		started <- err
	}()
	select {
	case err := <-started:
		if err != nil {
			return out, err
		}
	case <-ctx.Done():
		return out, ctx.Err()
	case <-s.closed:
		return out, errors.New("codex session is closed")
	}
	lastItem := ""
	hadText := false
	for {
		s.mu.Lock()
		queue := s.queue
		s.queue = nil
		s.mu.Unlock()
		for _, f := range queue {
			var p struct {
				ThreadID  string `json:"threadId"`
				TurnID    string `json:"turnId"`
				ItemID    string `json:"itemId"`
				Delta     string `json:"delta"`
				WillRetry bool   `json:"willRetry"`
				Turn      struct {
					ID, Status string
					Error      *rpcError
				} `json:"turn"`
				Error *rpcError                                  `json:"error"`
				Item  struct{ Type, Name, Tool, Command string } `json:"item"`
			}
			json.Unmarshal(f.Params, &p)
			s.mu.Lock()
			if f.Method == "turn/started" && s.turnID == "" {
				s.turnID = p.Turn.ID
			}
			tid := s.turnID
			s.mu.Unlock()
			if p.TurnID != "" && tid != "" && p.TurnID != tid {
				continue
			}
			switch f.Method {
			case "item/agentMessage/delta":
				sink.Text(p.Delta, hadText && lastItem != p.ItemID)
				lastItem = p.ItemID
				hadText = true
			case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
				sink.Reasoning(p.Delta)
			case "item/started":
				switch p.Item.Type {
				case "commandExecution":
					sink.Step(agents.ToolLabel("Bash", json.RawMessage(fmt.Sprintf(`{"command":%q}`, p.Item.Command))))
				case "fileChange":
					sink.Step("Edit files")
				case "mcpToolCall":
					sink.Step(agents.ToolLabel(p.Item.Tool, nil))
				}
			case "error":
				if p.WillRetry {
					continue
				}
				if p.Error != nil {
					return out, p.Error
				}
				return out, errors.New("codex turn failed")
			case "turn/completed":
				if tid != "" && p.Turn.ID != tid {
					continue
				}
				if p.Turn.Status == "failed" {
					if p.Turn.Error != nil {
						return out, p.Turn.Error
					}
					return out, errors.New("codex turn failed")
				}
				return out, nil
			}
		}
		select {
		case <-s.wake:
		case <-srv.done:
			return out, srv.process.Error()
		case <-s.closed:
			return out, errors.New("codex session is closed")
		case <-ctx.Done():
			return out, ctx.Err()
		}
	}
}

// Interrupt asks the server to stop the active native turn.
func (s *session) Interrupt(ctx context.Context) error {
	s.mu.Lock()
	srv, id, ready := s.server, s.turnID, s.turnReady
	s.mu.Unlock()
	if id == "" && ready != nil {
		select {
		case <-ready:
		case <-ctx.Done():
			return ctx.Err()
		}
		s.mu.Lock()
		id = s.turnID
		s.mu.Unlock()
	}
	if srv == nil || id == "" {
		return nil
	}
	_, err := srv.call(ctx, "turn/interrupt", map[string]string{"threadId": s.id, "turnId": id})
	return err
}

func scheduleIdle(pool *sharedServer) {
	if pool.refs != 0 || pool.server == nil {
		return
	}
	srv := pool.server
	var timer *time.Timer
	timer = time.AfterFunc(serverIdle, func() {
		shared.Lock()
		defer shared.Unlock()
		if pool.refs == 0 && pool.server == srv && pool.idle == timer {
			srv.process.Close()
			pool.server = nil
		}
	})
	pool.idle = timer
}

// Close detaches the conversation and releases the shared process when idle.
func (s *session) Close() error {
	s.once.Do(func() {
		close(s.closed)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = s.Interrupt(ctx)
		cancel()
		shared.Lock()
		defer shared.Unlock()
		pool := sharedFor(s.o)
		s.mu.Lock()
		srv := s.server
		s.mu.Unlock()
		if srv != nil {
			srv.mu.Lock()
			if srv.routes[s.id] == s {
				delete(srv.routes, s.id)
			}
			srv.mu.Unlock()
		}
		pool.refs--
		scheduleIdle(pool)
	})
	return nil
}
