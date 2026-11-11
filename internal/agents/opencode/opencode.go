// Package opencode runs native OpenCode v2 sessions.
//
// Routes verified against v2.0.32 /openapi.json (session objects wrap in data):
// server.info: GET /api/info; events: GET /api/event (SSE).
// session.create/get/update: POST /api/session, GET/PATCH /api/session/{id}.
// session.switchAgent/switchModel/prompt/interrupt: POST /api/session/{id}/agent,
// /model, /prompt, /interrupt. Bodies omit the sessionID path parameter.
// mcp.add/remove: PUT/DELETE /api/experimental/mcp/{server}, with
// location[directory] in the query and {config: ...} for PUT.
// permission.reply: POST /api/session/{id}/permission/{requestID}/reply.
// form.cancel: DELETE /api/session/{id}/form/{formID}.
// mcp.list: GET /api/mcp with location[directory]; this lists connection status,
// not the tools available to a model. No session tool inventory is exposed.
package opencode

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"faah/internal/agents"
)

// Agent opens conversations on a shared authenticated server.
type Agent struct{}

// New returns the native OpenCode adapter.
func New() *Agent { return &Agent{} }

// Name identifies the adapter.
func (*Agent) Name() string { return "opencode" }

var invalidName = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func mcpName(key string) string {
	name := "faah-" + invalidName.ReplaceAllString(key, "_")
	if len(name) > 64 {
		h := sha256.Sum256([]byte(key))
		name = "faah-" + hex.EncodeToString(h[:8])
	}
	return name
}

type rule struct {
	Action   string `json:"action"`
	Resource string `json:"resource"`
	Effect   string `json:"effect"`
}

func rules(o agents.Open, name string) []rule {
	r := []rule{{"edit", "*", "ask"}, {"edit", filepath.ToSlash(o.Dir) + "/*", "allow"}, {"bash", "*", "ask"}, {"external_directory", "*", "ask"}}
	if o.Mode == agents.ModePlan {
		r = append(r, rule{"edit", "*", "deny"})
	}
	r = append(r, rule{"faah-*", "*", "deny"})
	if o.Tools != nil {
		r = append(r, rule{name + "_*", "*", "allow"})
	}
	return r
}

// Open creates or resumes a conversation and applies its current permissions.
func (*Agent) Open(ctx context.Context, o agents.Open) (agents.Session, error) {
	dir, err := filepath.Abs(o.Dir)
	if err != nil {
		return nil, err
	}
	o.Dir = dir
	if o.Key == "" {
		b := make([]byte, 16)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		o.Key = hex.EncodeToString(b)
	}
	srv, release, err := acquire(ctx, o)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			release()
		}
	}()
	s := &session{o: o, server: srv, release: release, name: mcpName(o.Key), wake: make(chan struct{}, 1), closed: make(chan struct{})}
	var native struct{ ID, Agent string }
	if o.Resume != "" {
		err = srv.call(ctx, "GET", "/api/session/"+url.PathEscape(o.Resume), nil, &native)
	} else {
		body := map[string]any{"location": map[string]string{"directory": o.Dir}, "permissions": rules(o, s.name)}
		if o.Model != "" {
			model, e := modelRef(o.Model)
			if e != nil {
				return nil, e
			}
			body["model"] = model
		}
		err = srv.call(ctx, "POST", "/api/session", body, &native)
	}
	if err != nil {
		return nil, err
	}
	if native.ID == "" || (o.Resume != "" && native.ID != o.Resume) {
		return nil, errors.New("opencode returned an invalid session id")
	}
	s.id = native.ID
	s.agent = native.Agent
	if o.Resume != "" {
		if err = srv.call(ctx, "PATCH", s.path(), map[string]any{"permissions": rules(o, s.name)}, nil); err != nil {
			return nil, err
		}
		if o.Model != "" {
			model, e := modelRef(o.Model)
			if e != nil {
				return nil, e
			}
			if err = srv.call(ctx, "POST", s.path()+"/model", map[string]any{"model": model}, nil); err != nil {
				return nil, err
			}
		}
	}
	srv.mu.Lock()
	if srv.routes[s.id] != nil {
		srv.mu.Unlock()
		return nil, errors.New("opencode session already open")
	}
	srv.routes[s.id] = s
	srv.mu.Unlock()
	ok = true
	return s, nil
}

func modelRef(model string) (map[string]string, error) {
	provider, id, ok := strings.Cut(model, "/")
	if !ok || provider == "" || id == "" {
		return nil, fmt.Errorf("invalid opencode model %q: expected provider/model", model)
	}
	return map[string]string{"providerID": provider, "id": id}, nil
}

type session struct {
	o               agents.Open
	server          *server
	release         func()
	id, name, agent string
	turn            sync.Mutex
	mu              sync.Mutex
	active          bool
	queue           []event
	wake            chan struct{}
	closed          chan struct{}
	once            sync.Once
}

// ID returns the native conversation identifier.
func (s *session) ID() string { return s.id }

func (s *session) path() string { return "/api/session/" + url.PathEscape(s.id) }

func (s *session) mcpPath() string {
	return "/api/experimental/mcp/" + url.PathEscape(s.name) + "?" + url.Values{"location[directory]": {s.o.Dir}}.Encode()
}

// Close removes the tool endpoint and releases the shared server.
func (s *session) Close() error {
	var err error
	s.once.Do(func() {
		close(s.closed)
		s.server.mu.Lock()
		delete(s.server.routes, s.id)
		s.server.mu.Unlock()
		if s.o.Tools != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err = s.server.call(ctx, "DELETE", s.mcpPath(), nil, nil)
		}
		s.release()
	})
	return err
}

// Interrupt requests cancellation of this session's current execution.
func (s *session) Interrupt(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.server.call(ctx, "POST", s.path()+"/interrupt", map[string]any{}, nil)
}

func (s *session) enqueue(e event) {
	s.mu.Lock()
	if s.active {
		s.queue = append(s.queue, e)
	}
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Prompt streams a turn until its native execution end event.
func (s *session) Prompt(ctx context.Context, text string, sink agents.Sink) (agents.Outcome, error) {
	s.turn.Lock()
	defer s.turn.Unlock()
	out := agents.Outcome{SessionID: s.id, Live: true}
	select {
	case <-s.closed:
		return out, errors.New("opencode session closed")
	default:
	}
	agent := "build"
	if s.o.Mode == agents.ModePlan {
		agent = "plan"
	}
	if agent != s.agent {
		if err := s.server.call(ctx, "POST", s.path()+"/agent", map[string]string{"agent": agent}, nil); err != nil {
			return out, err
		}
		s.agent = agent
	}
	if ep := s.o.Tools; ep != nil {
		if err := s.server.call(ctx, "PUT", s.mcpPath(), map[string]any{"config": map[string]any{"type": "remote", "url": ep.URL, "headers": map[string]string{"Authorization": ep.Authorization}, "oauth": false}}, nil); err != nil {
			return out, err
		}
	}
	s.mu.Lock()
	s.active = true
	s.queue = nil
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.active = false; s.queue = nil; s.mu.Unlock() }()
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return out, err
	}
	if err := s.server.call(ctx, "POST", s.path()+"/prompt", map[string]string{"id": "msg_" + hex.EncodeToString(b), "text": text}, nil); err != nil {
		if s.server.process != nil {
			select {
			case <-s.server.process.Exited:
				out.Live = false
				return out, s.server.failure()
			case <-time.After(50 * time.Millisecond):
			}
		}
		return out, err
	}
	steps := map[string]bool{}
	last := ""
	had, boundary := false, false
	for {
		s.mu.Lock()
		q := s.queue
		s.queue = nil
		s.mu.Unlock()
		for _, e := range q {
			d := e.Data
			switch e.Type {
			case "session.text.delta":
				sink.Text(d.Delta, had && (boundary || last != d.ID))
				had = true
				boundary = false
				last = d.ID
			case "session.reasoning.delta":
				sink.Reasoning(d.Delta)
			case "session.tool.input.started", "session.tool.called":
				if !steps[d.ID] {
					steps[d.ID] = true
					boundary = true
					sink.Step(d.Name)
				}
			case "session.execution.succeeded":
				return out, nil
			case "session.execution.failed":
				return out, fmt.Errorf("opencode execution failed: %s", d.Error.Message)
			case "session.execution.interrupted":
				return out, context.Canceled
			case "permission.asked":
				decision := "reject"
				// Shell resources are commands, so they cannot establish path containment.
				if s.o.Mode == agents.ModeEdit && d.Action != "bash" && len(d.Resources) > 0 {
					allow := true
					for _, r := range d.Resources {
						if !inside(s.o.Dir, r) {
							allow = false
						}
					}
					if allow {
						decision = "once"
					}
				}
				if err := s.server.call(ctx, "POST", s.path()+"/permission/"+url.PathEscape(d.ID)+"/reply", map[string]string{"decision": decision}, nil); err != nil {
					return out, err
				}
			case "form.asked":
				if err := s.server.call(ctx, "DELETE", s.path()+"/form/"+url.PathEscape(d.ID), nil, nil); err != nil {
					return out, err
				}
			}
		}
		select {
		case <-s.wake:
		case <-ctx.Done():
			_ = s.Interrupt(context.Background())
			return out, ctx.Err()
		case <-s.closed:
			return out, errors.New("opencode session closed")
		case <-s.server.done:
			out.Live = false
			return out, s.server.failure()
		}
	}
}
