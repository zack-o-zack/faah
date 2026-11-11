package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"faah/internal/agents"
)

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_CODEX_HELPER") != "1" {
		os.Exit(m.Run())
	}
	log, _ := os.OpenFile(os.Getenv("FAAH_CODEX_LOG"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	defer log.Close()
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	threads := 0
	turns := 0
	pending := map[string]int{}
	held := map[string]string{}
	emit := func(method string, p any) { enc.Encode(map[string]any{"method": method, "params": p}) }
	finish := func(thread, turn string) {
		emit("turn/completed", map[string]any{"threadId": thread, "turn": map[string]string{"id": turn, "status": "completed"}})
	}
	for scan.Scan() {
		log.Write(append(append([]byte(nil), scan.Bytes()...), '\n'))
		var f struct {
			ID     json.RawMessage
			Method string
			Params map[string]any
			Result map[string]any
		}
		json.Unmarshal(scan.Bytes(), &f)
		respond := func(result any) { enc.Encode(map[string]any{"id": f.ID, "result": result}) }
		if f.Method == "" {
			key := strings.Trim(string(f.ID), `"`)
			thread := strings.Split(key, "/")[0]
			pending[thread]--
			if pending[thread] == 0 {
				finish(thread, held[thread])
			}
			continue
		}
		switch f.Method {
		case "initialize":
			respond(map[string]any{})
		case "thread/start":
			threads++
			respond(map[string]any{"model": "reported-model", "thread": map[string]string{"id": fmt.Sprint("thread-", threads)}})
		case "thread/resume":
			if f.Params["threadId"] == "archived" && held["unarchived"] == "" {
				enc.Encode(map[string]any{"id": f.ID, "error": map[string]any{"code": -1, "message": "thread archived"}})
				continue
			}
			respond(map[string]any{"model": "reported-model", "thread": map[string]any{"id": f.Params["threadId"]}})
		case "thread/unarchive":
			held["unarchived"] = "yes"
			respond(map[string]any{})
		case "turn/start":
			thread := f.Params["threadId"].(string)
			text := f.Params["input"].([]any)[0].(map[string]any)["text"].(string)
			turns++
			turn := fmt.Sprint("turn-", turns)
			held[thread] = turn
			if text == "crash" {
				os.Stderr.WriteString("fake codex crashed")
				os.Exit(2)
			}
			if text == "notification-only" {
				emit("turn/started", map[string]any{"threadId": thread, "turn": map[string]string{"id": turn}})
				continue
			}
			if text == "delayed" {
				time.Sleep(200 * time.Millisecond)
			}
			respond(map[string]any{"turn": map[string]string{"id": turn}})
			emit("turn/started", map[string]any{"threadId": thread, "turn": map[string]string{"id": turn}})
			if text == "hold" || text == "delayed" {
				continue
			}
			emit("item/agentMessage/delta", map[string]string{"threadId": thread, "turnId": turn, "itemId": "answer", "delta": text})
			emit("item/reasoning/textDelta", map[string]string{"threadId": thread, "turnId": turn, "delta": "thinking"})
			if text == "native-tools" {
				emit("item/started", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]string{"type": "commandExecution", "command": "cat file.go"}})
				emit("item/started", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]string{"type": "mcpToolCall", "tool": "mcp__faah__annotate"}})
				finish(thread, turn)
				continue
			}
			emit("item/started", map[string]any{"threadId": thread, "turnId": turn, "item": map[string]string{"type": "commandExecution", "command": "pwd"}})
			if text == "approvals" {
				methods := []string{"item/commandExecution/requestApproval", "item/fileChange/requestApproval", "execCommandApproval", "applyPatchApproval", "item/permissions/requestApproval", "mcpServer/elicitation/request", "item/tool/requestUserInput", "unknown"}
				pending[thread] = len(methods)
				for i, method := range methods {
					enc.Encode(map[string]any{"id": fmt.Sprintf("%s/%d", thread, i), "method": method, "params": map[string]any{"threadId": thread, "permissions": map[string]any{"network": map[string]bool{"enabled": true}}}})
				}
				continue
			}
			if text == "failed" {
				emit("turn/completed", map[string]any{"threadId": thread, "turn": map[string]any{"id": turn, "status": "failed", "error": map[string]string{"message": "turn broke"}}})
				continue
			}
			if text == "error" {
				emit("error", map[string]any{"threadId": thread, "error": map[string]string{"message": "notification broke"}})
				continue
			}
			if text == "retry" {
				emit("error", map[string]any{"threadId": thread, "willRetry": true, "error": map[string]string{"message": "transient"}})
			}
			finish(thread, turn)
		case "turn/interrupt":
			respond(map[string]any{})
			finish(f.Params["threadId"].(string), f.Params["turnId"].(string))
		}
	}
	os.Exit(0)
}

func TestCodexCancelAndCloseInterruptPendingTurns(t *testing.T) {
	for _, text := range []string{"hold", "delayed", "notification-only"} {
		for _, action := range []string{"cancel", "close"} {
			t.Run(text+"/"+action, func(t *testing.T) {
				ctx, o := setup(t)
				ctx, cancel := context.WithCancel(ctx)
				defer cancel()
				s, err := New().Open(ctx, o)
				if err != nil {
					t.Fatal(err)
				}
				defer s.Close()
				done := make(chan error, 1)
				go func() { _, err := s.Prompt(ctx, text, &capture{}); done <- err }()
				deadline := time.After(2 * time.Second)
				for {
					started := false
					for _, frame := range wire(t, o) {
						started = started || frame["method"] == "turn/start"
					}
					if started {
						break
					}
					select {
					case <-deadline:
						t.Fatal("turn/start not sent")
					case <-time.After(time.Millisecond):
					}
				}
				if action == "cancel" {
					cancel()
				} else if err := s.Close(); err != nil {
					t.Fatal(err)
				}
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("turn unexpectedly completed")
					}
				case <-time.After(6 * time.Second):
					t.Fatal("turn did not stop")
				}
				for _, frame := range wire(t, o) {
					if frame["method"] == "turn/interrupt" {
						return
					}
				}
				t.Fatal("native turn was not interrupted")
			})
		}
	}
}

type capture struct {
	text, reason string
	steps        []string
}

func (s *capture) Text(t string, _ bool) { s.text += t }
func (s *capture) Reasoning(t string)    { s.reason += t }
func (s *capture) Step(t string)         { s.steps = append(s.steps, t) }
func (*capture) Result(string)           {}

func setup(t *testing.T) (context.Context, agents.Open) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	t.Cleanup(func() {
		shared.Lock()
		for key, pool := range shared.servers {
			if pool.idle != nil {
				pool.idle.Stop()
			}
			if pool.server != nil {
				pool.server.process.Close()
				<-pool.server.done
			}
			delete(shared.servers, key)
		}
		shared.Unlock()
	})
	exe, _ := os.Executable()
	return ctx, agents.Open{Base: []string{exe}, Dir: t.TempDir(), Model: "test-model", Version: "1.2.3", Env: []string{"FAAH_CODEX_HELPER=1", "FAAH_CODEX_LOG=" + filepath.Join(t.TempDir(), "wire")}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer secret"}}
}

func wire(t *testing.T, o agents.Open) []map[string]any {
	t.Helper()
	path := strings.TrimPrefix(o.Env[1], "FAAH_CODEX_LOG=")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var f map[string]any
		if err := json.Unmarshal([]byte(line), &f); err != nil {
			t.Fatal(err)
		}
		if _, ok := f["jsonrpc"]; ok {
			t.Fatal("unexpected framing")
		}
		result = append(result, f)
	}
	return result
}

func TestCodexAskNativeReadAndMCPEvents(t *testing.T) {
	ctx, open := setup(t)
	open.Mode = agents.ModeAsk
	session, err := New().Open(ctx, open)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	sink := &capture{}
	if _, err := session.Prompt(ctx, "native-tools", sink); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(sink.steps, []string{"Bash cat file.go", "mcp__faah__annotate"}) {
		t.Fatal(sink.steps)
	}
	for _, frame := range wire(t, open) {
		if frame["method"] == nil {
			t.Fatal("native read/MCP notifications unexpectedly required a client approval", frame)
		}
	}
}

func TestCodexProtocol(t *testing.T) {
	for _, mode := range []agents.Mode{agents.ModeAsk, agents.ModeEdit} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			ctx, o := setup(t)
			o.Mode = mode
			s, err := New().Open(ctx, o)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			c := &capture{}
			if _, err = s.Prompt(ctx, "approvals", c); err != nil {
				t.Fatal(err)
			}
			if c.text != "approvals" || c.reason != "thinking" || len(c.steps) != 1 {
				t.Fatalf("%+v", c)
			}
			frames := wire(t, o)
			init := frames[0]
			if init["id"] != float64(1) || init["method"] != "initialize" {
				t.Fatal(init)
			}
			wantInit := map[string]any{"clientInfo": map[string]any{"name": "faah", "title": "faah", "version": "1.2.3"}, "capabilities": map[string]any{"experimentalApi": true}}
			if !reflect.DeepEqual(init["params"], wantInit) || frames[1]["method"] != "initialized" {
				t.Fatal(frames[:2])
			}
			config := frames[2]["params"].(map[string]any)["config"]
			threadParams := frames[2]["params"].(map[string]any)
			if mode == agents.ModeAsk && (threadParams["permissions"] != nil || threadParams["sandbox"] != "read-only" || threadParams["approvalPolicy"] != "untrusted") {
				t.Fatal(threadParams)
			}
			wantConfig := map[string]any{"mcp_servers.faah": map[string]any{"url": o.Tools.URL, "http_headers": map[string]any{"Authorization": o.Tools.Authorization}, "tool_timeout_sec": float64(3900), "omit_tools_from": []any{"code_mode", "deferred"}}, "mcp_optional_startup_grace_ms": float64(10000)}
			if !reflect.DeepEqual(config, wantConfig) {
				t.Fatalf("config: %#v", config)
			}
			p := frames[3]["params"].(map[string]any)
			// Experimental v2/TurnStartParams.json defines collaborationMode.settings.model.
			modeName := "default"
			if !reflect.DeepEqual(p["collaborationMode"], map[string]any{"mode": modeName, "settings": map[string]any{"model": o.Model}}) {
				t.Fatal(p)
			}
			policy, sandbox := "on-request", "workspaceWrite"
			if mode == agents.ModeAsk {
				policy, sandbox = "untrusted", "readOnly"
			}
			sandboxOK := p["sandboxPolicy"].(map[string]any)["type"] == sandbox && p["permissions"] == nil
			if p["approvalPolicy"] != policy || !sandboxOK || p["model"] != o.Model || p["cwd"] != o.Dir {
				t.Fatal(p)
			}
			for i, f := range frames[4:] {
				r, _ := f["result"].(map[string]any)
				switch i {
				case 0, 1:
					w := "decline"
					if mode == agents.ModeEdit {
						w = "accept"
					}
					if r["decision"] != w {
						t.Fatal(f)
					}
				case 2, 3:
					if mode == agents.ModeEdit && r["decision"] != "approved" {
						t.Fatal(f)
					}
					if mode == agents.ModeAsk {
						if _, ok := r["decision"].(map[string]any)["denied"]; !ok {
							t.Fatal(f)
						}
					}
				case 4:
					perm := r["permissions"].(map[string]any)
					if (len(perm) > 0) != (mode == agents.ModeEdit) || r["scope"] != "turn" {
						t.Fatal(f)
					}
				case 5:
					if r["action"] != "decline" {
						t.Fatal(f)
					}
				case 6:
					if len(r["answers"].(map[string]any)) != 0 {
						t.Fatal(f)
					}
				case 7:
					if f["error"] == nil {
						t.Fatal(f)
					}
				}
			}
			id := s.ID()
			s.Close()
			o.Resume = id
			resumed, err := New().Open(ctx, o)
			if err != nil {
				t.Fatal(err)
			}
			defer resumed.Close()
			if resumed.ID() != id {
				t.Fatal("resume changed id")
			}
			if _, err = resumed.Prompt(ctx, "again", &capture{}); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, f := range wire(t, o) {
				if f["method"] == "thread/resume" {
					p := f["params"].(map[string]any)
					found = p["threadId"] == id && p["excludeTurns"] == true
				}
			}
			if !found {
				t.Fatal("missing resume")
			}
		})
	}
}

func TestCodexSharedProcessInterruptAndCrash(t *testing.T) {
	ctx, o := setup(t)
	a := New()
	s1, err := a.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer s1.Close()
	s2, err := a.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if s1.(*session).server != s2.(*session).server {
		t.Fatal("sessions did not share process")
	}
	done := make(chan error, 1)
	go func() { _, err := s1.Prompt(ctx, "hold", &capture{}); done <- err }()
	deadline := time.Now().Add(time.Second)
	for {
		s := s1.(*session)
		s.mu.Lock()
		ready := s.turnID != ""
		s.mu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("turn did not start")
		}
		time.Sleep(time.Millisecond)
	}
	c := &capture{}
	if _, err = s2.Prompt(ctx, "other session", c); err != nil || c.text != "other session" {
		t.Fatalf("%+v %v", c, err)
	}
	select {
	case <-done:
		t.Fatal("text from other thread completed held turn")
	default:
	}
	if err = s1.Interrupt(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); _, err := s1.Prompt(ctx, "hold", &capture{}); done <- err }()
	deadline = time.Now().Add(time.Second)
	for {
		s := s1.(*session)
		s.mu.Lock()
		ready := s.turnID != ""
		s.mu.Unlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("second held turn did not start")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err = s2.Prompt(ctx, "crash", &capture{}); err == nil || !strings.Contains(err.Error(), "fake codex crashed") {
		t.Fatal(err)
	}
	wg.Wait()
	if err = <-done; err == nil || !strings.Contains(err.Error(), "fake codex crashed") {
		t.Fatal(err)
	}
	old := s1.(*session).server
	if _, err = s1.Prompt(ctx, "recovered", &capture{}); err != nil {
		t.Fatal(err)
	}
	if s1.(*session).server == old {
		t.Fatal("dead server reused")
	}
	for _, text := range []string{"failed", "error"} {
		if _, err = s1.Prompt(ctx, text, &capture{}); err == nil || !strings.Contains(err.Error(), "broke") {
			t.Fatal(err)
		}
	}
}

func TestCodexArchivedResume(t *testing.T) {
	ctx, o := setup(t)
	o.Resume = "archived"
	s, err := New().Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	methods := []string{}
	for _, f := range wire(t, o) {
		if m, _ := f["method"].(string); strings.HasPrefix(m, "thread/") {
			methods = append(methods, m)
		}
	}
	if !reflect.DeepEqual(methods, []string{"thread/resume", "thread/unarchive", "thread/resume"}) {
		t.Fatal(methods)
	}
}

func TestCodexIdleProcess(t *testing.T) {
	ctx, o := setup(t)
	s, err := New().Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	srv := s.(*session).server
	second, err := New().Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	shared.Lock()
	idle := sharedFor(o).idle
	shared.Unlock()
	if idle != nil {
		t.Fatal("scheduled shutdown with a live session")
	}
	o.Resume = second.ID()
	second.Close()
	shared.Lock()
	sharedFor(o).idle.Reset(time.Millisecond)
	shared.Unlock()
	select {
	case <-srv.done:
	case <-ctx.Done():
		t.Fatal("idle process did not exit")
	}
	resumed, err := New().Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	if resumed.(*session).server == srv {
		t.Fatal("idle server reused")
	}
}

func TestCodexReportedModelRetryAndSeparateArgv(t *testing.T) {
	ctx, o := setup(t)
	o.Model = ""
	a, err := New().Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	if _, err = a.Prompt(ctx, "retry", &capture{}); err != nil {
		t.Fatal(err)
	}
	frames := wire(t, o)
	for _, f := range frames {
		if f["method"] == "turn/start" {
			p := f["params"].(map[string]any)
			settings := p["collaborationMode"].(map[string]any)["settings"].(map[string]any)
			if settings["model"] != "reported-model" {
				t.Fatal(p)
			}
		}
	}
	if a.(*session).model != "reported-model" {
		t.Fatal("missing reported model")
	}
	other := o
	other.Base = append(append([]string{}, o.Base...), "--different")
	b, err := New().Open(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if a.(*session).server == b.(*session).server {
		t.Fatal("different argv shared a process")
	}
}
