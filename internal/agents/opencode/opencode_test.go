package opencode

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"faah/internal/agents"
)

type fake struct {
	t             *testing.T
	mu            sync.Mutex
	calls         []request
	streams       int
	clients       map[chan event]bool
	promptStarted chan struct{}
	promptRelease chan struct{}
	next          int
}

type request struct {
	Method, Path string
	Body         map[string]any
	Directory    string
}

func (f *fake) serve(w http.ResponseWriter, r *http.Request) {
	user, pw, ok := r.BasicAuth()
	if !ok || user != "opencode" || pw != "secret" {
		f.t.Error("missing Basic auth")
		w.WriteHeader(401)
		return
	}
	if r.URL.Path == "/api/event" {
		if r.Header.Get("Accept") != "text/event-stream" {
			f.t.Error("missing SSE Accept")
		}
		ch := make(chan event, 64)
		f.mu.Lock()
		f.streams++
		f.clients[ch] = true
		f.mu.Unlock()
		defer func() { f.mu.Lock(); delete(f.clients, ch); f.mu.Unlock() }()
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		for {
			select {
			case e := <-ch:
				if e.Type == "drop" {
					return
				}
				b, _ := json.Marshal(e)
				fmt.Fprintf(w, "data: %s\n\n", b)
				w.(http.Flusher).Flush()
			case <-r.Context().Done():
				return
			}
		}
	}
	var body map[string]any
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	f.mu.Lock()
	f.calls = append(f.calls, request{r.Method, r.URL.Path, body, r.URL.Query().Get("location[directory]")})
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.URL.Path == "/api/session" && r.Method == "POST":
		f.mu.Lock()
		f.next++
		id := fmt.Sprintf("ses_%d", f.next)
		f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"id": id, "agent": "build"}})
	case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/session/"):
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"id": strings.TrimPrefix(r.URL.Path, "/api/session/"), "agent": "build"}})
	case strings.HasSuffix(r.URL.Path, "/prompt"):
		id := strings.Split(r.URL.Path, "/")[3]
		text, _ := body["text"].(string)
		if text == "delayed" {
			close(f.promptStarted)
			select {
			case <-f.promptRelease:
			case <-r.Context().Done():
			}
			w.WriteHeader(204)
			return
		}
		if text == "hold" {
			w.WriteHeader(204)
			return
		}
		f.emit("other", "session.execution.failed", map[string]any{"error": map[string]string{"message": "wrong session"}})
		for _, kind := range []string{"session.text.delta", "session.reasoning.delta", "session.tool.input.started", "session.tool.called", "session.text.delta"} {
			f.emit(id, kind, map[string]any{"id": "part", "name": "read", "delta": "hello"})
		}
		f.emit(id, "permission.asked", map[string]any{"id": "perm_in", "resources": []string{"file.go"}})
		f.emit(id, "permission.asked", map[string]any{"id": "perm_out", "resources": []string{"/outside"}})
		f.emit(id, "permission.asked", map[string]any{"id": "perm_bash", "action": "bash", "resources": []string{"rm -rf /"}})
		f.emit(id, "permission.asked", map[string]any{"id": "perm_shell", "action": "shell", "resources": []string{"go test ./..."}})
		f.emit(id, "form.asked", map[string]any{"id": "form"})
		kind := "succeeded"
		if text == "failed" || text == "interrupted" {
			kind = text
		}
		f.emit(id, "session.execution."+kind, map[string]any{"error": map[string]string{"message": "bad model"}})
		w.WriteHeader(204)
	case strings.HasSuffix(r.URL.Path, "/interrupt"):
		f.emit(strings.Split(r.URL.Path, "/")[3], "session.execution.interrupted", nil)
		w.WriteHeader(204)
	default:
		w.WriteHeader(204)
	}
}

func (f *fake) emit(id, kind string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["sessionID"] = id
	b, _ := json.Marshal(map[string]any{"type": kind, "data": data})
	var e event
	json.Unmarshal(b, &e)
	f.mu.Lock()
	defer f.mu.Unlock()
	for ch := range f.clients {
		ch <- e
	}
}

func fixture(t *testing.T) (*fake, *server, agents.Open) {
	t.Helper()
	f := &fake{t: t, clients: map[chan event]bool{}}
	h := httptest.NewServer(http.HandlerFunc(f.serve))
	s := newServer(h.URL, "secret")
	go s.events()
	select {
	case <-s.ready:
	case <-time.After(time.Second):
		t.Fatal("no SSE")
	}
	o := agents.Open{Dir: t.TempDir(), Key: "thread:a", Model: "provider/model", Base: []string{"fake-" + t.Name()}, Tools: &agents.ToolEndpoint{URL: "http://localhost/mcp", Authorization: "Bearer token"}}
	shared.Lock()
	shared.servers[o.Base[0]] = s
	shared.Unlock()
	t.Cleanup(func() {
		s.stop()
		shared.Lock()
		if s.idle != nil {
			s.idle.Stop()
		}
		delete(shared.servers, o.Base[0])
		shared.Unlock()
		h.Close()
	})
	return f, s, o
}

type capture struct {
	text, reason string
	steps        []string
	blocks       []bool
}

func (c *capture) Text(s string, b bool) { c.text += s; c.blocks = append(c.blocks, b) }

func (c *capture) Reasoning(s string) { c.reason += s }

func (c *capture) Step(s string) { c.steps = append(c.steps, s) }

func (*capture) Result(string) {}

func TestOpenCodeSessions(t *testing.T) {
	for _, mode := range []agents.Mode{agents.ModeEdit, agents.ModePlan} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			f, _, o := fixture(t)
			o.Mode = mode
			a := New()
			s, err := a.Open(context.Background(), o)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			c := &capture{}
			out, err := s.Prompt(context.Background(), "hello", c)
			if err != nil || out.SessionID != s.ID() || !out.Live || c.text != "hellohello" || c.reason != "hello" || len(c.steps) != 1 || !reflect.DeepEqual(c.blocks, []bool{false, true}) {
				t.Fatalf("%+v %+v %v", out, c, err)
			}
			for _, text := range []string{"failed", "interrupted"} {
				if _, err = s.Prompt(context.Background(), text, &capture{}); err == nil {
					t.Fatal(text + " succeeded")
				}
			}
			f.mu.Lock()
			calls := append([]request(nil), f.calls...)
			f.mu.Unlock()
			switches := 0
			adds := 0
			for _, r := range calls {
				if r.Path == "/api/session" {
					expected := []rule{{"edit", "*", "ask"}, {"edit", filepath.ToSlash(o.Dir) + "/*", "allow"}, {"bash", "*", "ask"}, {"external_directory", "*", "ask"}}
					if mode == agents.ModePlan {
						expected = append(expected, rule{"edit", "*", "deny"}, rule{"bash", "*", "deny"}, rule{"shell", "*", "deny"}, rule{"webfetch", "*", "deny"}, rule{"websearch", "*", "deny"}, rule{"execute", "*", "deny"})
					}
					expected = append(expected, rule{"faah-*", "*", "deny"}, rule{"faah-thread_a_*", "*", "allow"})
					raw, _ := json.Marshal(expected)
					var normalized any
					json.Unmarshal(raw, &normalized)
					want, _ := json.Marshal(normalized)
					got, _ := json.Marshal(r.Body["permissions"])
					if string(got) != string(want) {
						t.Fatalf("rules: %s", got)
					}
					if !reflect.DeepEqual(r.Body["model"], map[string]any{"providerID": "provider", "id": "model"}) {
						t.Fatal(r)
					}
				}
				if strings.HasSuffix(r.Path, "/agent") {
					switches++
					if r.Body["agent"] != "faah-plan" {
						t.Fatal(r)
					}
				}
				if r.Method == "PUT" {
					adds++
					if r.Path != "/api/experimental/mcp/faah-thread_a" || r.Directory != o.Dir || !reflect.DeepEqual(r.Body, map[string]any{"config": map[string]any{"type": "remote", "url": o.Tools.URL, "headers": map[string]any{"Authorization": "Bearer token"}, "oauth": false, "codemode": false}}) {
						t.Fatalf("MCP %+v", r)
					}
				}
				if strings.HasSuffix(r.Path, "/reply") {
					want := "reject"
					if mode == agents.ModeEdit && (strings.Contains(r.Path, "perm_in") || strings.Contains(r.Path, "perm_bash") || strings.Contains(r.Path, "perm_shell")) {
						want = "once"
					}
					if r.Body["decision"] != want {
						t.Fatal(r)
					}
				}
				if strings.HasSuffix(r.Path, "/prompt") && !strings.HasPrefix(r.Body["id"].(string), "msg_") {
					t.Fatal(r)
				}
			}
			if adds != 3 || (mode == agents.ModePlan && switches != 1) || (mode == agents.ModeEdit && switches != 0) {
				t.Fatal(adds, switches)
			}
			id := s.ID()
			s.Close()
			o.Resume = id
			resumed, err := a.Open(context.Background(), o)
			if err != nil || resumed.ID() != id {
				t.Fatal(err)
			}
			resumed.Close()
		})
	}
}

func TestOpenCodeCancelAndCloseInterruptPendingPrompt(t *testing.T) {
	for _, action := range []string{"cancel", "close"} {
		t.Run(action, func(t *testing.T) {
			f, _, o := fixture(t)
			f.promptStarted = make(chan struct{})
			f.promptRelease = make(chan struct{})
			defer close(f.promptRelease)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s, err := New().Open(ctx, o)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			done := make(chan error, 1)
			go func() { _, err := s.Prompt(ctx, "delayed", &capture{}); done <- err }()
			select {
			case <-f.promptStarted:
			case <-time.After(time.Second):
				t.Fatal("prompt not sent")
			}
			if action == "cancel" {
				cancel()
			} else if err := s.Close(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-time.After(6 * time.Second):
				cancel()
				t.Fatal("prompt did not stop")
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			for _, call := range f.calls {
				if call.Path == "/api/session/"+s.ID()+"/interrupt" {
					return
				}
			}
			t.Fatal("native session was not interrupted")
		})
	}
}

func TestOpenCodeRoutingReconnectInterruptExit(t *testing.T) {
	f, srv, o := fixture(t)
	a := New()
	one, err := a.Open(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer one.Close()
	o.Key = "two"
	two, err := a.Open(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	defer two.Close()
	done := make(chan error, 2)
	for _, s := range []agents.Session{one, two} {
		go func(s agents.Session) { _, err := s.Prompt(context.Background(), "hold", &capture{}); done <- err }(s)
	}
	wait(t, func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		n := 0
		for _, r := range f.calls {
			if strings.HasSuffix(r.Path, "/prompt") {
				n++
			}
		}
		return n == 2
	})
	f.emit("", "drop", nil)
	wait(t, func() bool { f.mu.Lock(); defer f.mu.Unlock(); return f.streams >= 2 })
	if err = one.Interrupt(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		if err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupt hung")
	}
	srv.stop()
	select {
	case err = <-done:
		if err == nil || !strings.Contains(err.Error(), "stopped") {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("exit hung")
	}
}

func wait(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !check() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestOpenCodeNamesAndPaths(t *testing.T) {
	if mcpName("a:b") != "faah-a_b" {
		t.Fatal(mcpName("a:b"))
	}
	if got := mcpName(strings.Repeat("a", 100)); len(got) != 21 || got != mcpName(strings.Repeat("a", 100)) {
		t.Fatal(got)
	}
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"../outside", filepath.Join(dir, "link", "new"), ""} {
		if inside(dir, p) {
			t.Fatal(p)
		}
	}
	if !inside(dir, "new/file.go") {
		t.Fatal("new file rejected")
	}
}

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_OPENCODE_HELPER") != "1" {
		os.Exit(m.Run())
	}
	port := ""
	for _, a := range os.Args {
		if strings.HasPrefix(a, "--port=") {
			port = strings.TrimPrefix(a, "--port=")
		}
	}
	if os.Getenv("OPENCODE_SERVER_PASSWORD") != "" || !validHelperConfig(os.Getenv("OPENCODE_CONFIG_CONTENT")) {
		os.Exit(3)
	}
	password := os.Getenv("OPENCODE_PASSWORD")
	b, err := hex.DecodeString(password)
	if err != nil || len(b) != 32 {
		os.Exit(4)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(5)
	}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		user, pw, ok := r.BasicAuth()
		if !ok || user != "opencode" || pw != password {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.URL.Path == "/api/event":
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		case r.URL.Path == "/api/session":
			fmt.Fprintln(w, `{"data":{"id":"ses_native","agent":"build"}}`)
		case strings.HasSuffix(r.URL.Path, "/prompt"):
			os.Stderr.WriteString("helper crashed deliberately\n")
			os.Exit(7)
		default:
			w.WriteHeader(204)
		}
	})
	fmt.Fprintf(os.Stderr, "server listening on http://%s\n", listener.Addr())
	http.Serve(listener, nil)
	os.Exit(0)
}

func TestOpenCodeProcessRestartAndIdle(t *testing.T) {
	exe, _ := os.Executable()
	o := agents.Open{Base: []string{exe}, Dir: t.TempDir(), Env: []string{"FAAH_OPENCODE_HELPER=1", `OPENCODE_CONFIG_CONTENT={"model":"user/model","agents":{"plan":{"disabled":true},"custom":{"mode":"subagent"}}}`, "OPENCODE_SERVER_PASSWORD=remove"}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	a := New()
	s, err := a.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	srv := s.(*session).server
	_, err = s.Prompt(ctx, "crash", &capture{})
	if err == nil || !strings.Contains(err.Error(), "helper crashed deliberately") {
		t.Fatalf("missing exit diagnostics: %v", err)
	}
	s.Close()
	next, err := a.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer next.Close()
	if next.(*session).server == srv {
		t.Fatal("reused exited process")
	}
	live := next.(*session).server
	shared.Lock()
	live.idleDelay = 20 * time.Millisecond
	shared.Unlock()
	next.Close()
	select {
	case <-live.done:
	case <-ctx.Done():
		t.Fatal("idle server stayed alive")
	}
	select {
	case <-live.process.Exited:
	case <-ctx.Done():
		t.Fatal("idle process stayed alive")
	}
}

func TestOpenCodeToolReplacementAndRemoval(t *testing.T) {
	f, _, o := fixture(t)
	s, err := New().Open(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Prompt(context.Background(), "hello", &capture{}); err != nil {
		t.Fatal(err)
	}
	o.Tools.URL = "http://localhost/changed"
	o.Tools.Authorization = "Bearer changed"
	if _, err = s.Prompt(context.Background(), "hello", &capture{}); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	adds := []request{}
	removed := false
	for _, r := range f.calls {
		if r.Method == "PUT" {
			adds = append(adds, r)
		}
		if r.Method == "DELETE" && strings.HasPrefix(r.Path, "/api/experimental/mcp/") {
			removed = true
		}
	}
	if len(adds) != 2 || !removed {
		t.Fatal(adds, removed)
	}
	config := adds[1].Body["config"].(map[string]any)
	if config["url"] != o.Tools.URL || config["headers"].(map[string]any)["Authorization"] != o.Tools.Authorization {
		t.Fatal(config)
	}
}

func TestOpenCodeSharedIdleOwnership(t *testing.T) {
	_, srv, o := fixture(t)
	srv.idleDelay = 20 * time.Millisecond
	one, err := New().Open(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	two, err := New().Open(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	one.Close()
	shared.Lock()
	refs, timer := srv.refs, srv.idle
	shared.Unlock()
	if refs != 1 || timer != nil {
		t.Fatal("server retired with a live session", refs, timer)
	}
	two.Close()
	select {
	case <-srv.done:
	case <-time.After(time.Second):
		t.Fatal("last session did not retire server")
	}
}

func validHelperConfig(content string) bool {
	var c struct {
		Model  string
		Agents map[string]json.RawMessage
	}
	if json.Unmarshal([]byte(content), &c) != nil {
		return false
	}
	var p struct {
		Mode        string
		Permissions []rule
	}
	if json.Unmarshal(c.Agents["faah-plan"], &p) != nil {
		return false
	}
	return c.Model == "user/model" && string(c.Agents["plan"]) == `{"disabled":true}` && string(c.Agents["custom"]) == `{"mode":"subagent"}` && p.Mode == "primary" && reflect.DeepEqual(p.Permissions, []rule{{"edit", "*", "deny"}, {"bash", "*", "deny"}, {"shell", "*", "deny"}, {"webfetch", "*", "deny"}, {"websearch", "*", "deny"}, {"execute", "*", "deny"}})
}

func TestOpenCodeInvalidConfig(t *testing.T) {
	for _, content := range []string{`bad`, `null`, `{"agents":[]}`, `{"agents":null}`} {
		if _, err := planConfig(content); err == nil {
			t.Fatalf("accepted %s", content)
		}
	}
}
