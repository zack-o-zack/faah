package cursor

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

func TestMain(m *testing.M) {
	if path := os.Getenv("FAAH_CURSOR_LOCK_HELPER"); path != "" {
		lock, err := lockInstall(context.Background(), path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer lock.Close()
		fmt.Println("locked")
		bufio.NewScanner(os.Stdin).Scan()
		os.Exit(0)
	}
	if os.Getenv("FAAH_CURSOR_HELPER") == "1" {
		enc := json.NewEncoder(os.Stdout)
		scan := bufio.NewScanner(os.Stdin)
		ignoreCancel := false
		for scan.Scan() {
			var r map[string]any
			json.Unmarshal(scan.Bytes(), &r)
			switch r["op"] {
			case "open":
				switch os.Getenv("FAAH_CURSOR_OPEN") {
				case "error":
					enc.Encode(map[string]string{"op": "error", "message": "login required"})
					continue
				case "crash":
					fmt.Fprintln(os.Stderr, "startup failed")
					os.Exit(2)
				}
				b, _ := json.Marshal(r)
				os.WriteFile(os.Getenv("FAAH_CURSOR_CAPTURE"), append(b, '\n'), 0600)
				id, _ := r["agentId"].(string)
				if id == "" {
					id = "native"
				}
				enc.Encode(map[string]string{"op": "opened", "agentId": id})
			case "send":
				f, _ := os.OpenFile(os.Getenv("FAAH_CURSOR_CAPTURE"), os.O_APPEND|os.O_WRONLY, 0600)
				b, _ := json.Marshal(r)
				f.Write(append(b, '\n'))
				f.Close()
				switch r["text"] {
				case "crash":
					fmt.Fprintln(os.Stderr, "helper exploded")
					os.Exit(2)
				case "fail":
					enc.Encode(map[string]string{"op": "done", "status": "error", "error": "quota exhausted"})
					continue
				case "wait", "ignore-cancel":
					ignoreCancel = r["text"] == "ignore-cancel"
					enc.Encode(map[string]any{"op": "delta", "update": map[string]string{"type": "thinking-delta", "text": "waiting"}})
					continue
				}
				for _, u := range []string{`{"type":"text-delta","text":"hello"}`, `{"type":"thinking-delta","text":"think"}`, `{"type":"tool-call-started","callId":"c","toolCall":{"type":"read","args":{"path":"a.go"}}}`, `{"type":"tool-call-started","callId":"c","toolCall":{"type":"read","args":{"path":"a.go"}}}`, `{"type":"text-delta","text":"world"}`} {
					enc.Encode(map[string]any{"op": "delta", "update": json.RawMessage(u)})
				}
				enc.Encode(map[string]string{"op": "done", "status": "finished"})
			case "cancel":
				if !ignoreCancel {
					enc.Encode(map[string]string{"op": "done", "status": "cancelled"})
				}
			case "close":
				os.Exit(0)
			}
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

type recording struct {
	text, reasoning, steps []string
	blocks                 []bool
	started                chan struct{}
}

func (r *recording) Text(s string, b bool) {
	r.text = append(r.text, s)
	r.blocks = append(r.blocks, b)
}

func (r *recording) Reasoning(s string) {
	r.reasoning = append(r.reasoning, s)
	if r.started != nil {
		close(r.started)
		r.started = nil
	}
}

func (r *recording) Step(s string) { r.steps = append(r.steps, s) }

func (r *recording) Result(s string) { r.text = append(r.text, s) }

func fakeSession(t *testing.T, o agents.Open) (agents.Session, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "requests")
	o.Env = append(o.Env, "FAAH_CURSOR_HELPER=1", "FAAH_CURSOR_CAPTURE="+path)
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, err := openHelper(ctx, o, []string{exe}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}

func TestCursorProtocol(t *testing.T) {
	for _, mode := range []agents.Mode{agents.ModeEdit, agents.ModePlan} {
		for _, resume := range []string{"", "previous"} {
			t.Run(fmt.Sprint(mode, resume), func(t *testing.T) {
				o := agents.Open{Dir: t.TempDir(), Resume: resume, Mode: mode, Model: "chosen", Tools: &agents.ToolEndpoint{URL: "http://localhost/mcp", Authorization: "Bearer secret"}}
				s, path := fakeSession(t, o)
				wantID := "native"
				if resume != "" {
					wantID = resume
				}
				if s.ID() != wantID {
					t.Fatal(s.ID())
				}
				for i := 0; i < 2; i++ {
					r := &recording{}
					out, err := s.Prompt(context.Background(), "hello", r)
					if err != nil || out.SessionID != wantID || !out.Live || strings.Join(r.text, "") != "helloworld" || strings.Join(r.reasoning, "") != "think" || !reflect.DeepEqual(r.steps, []string{"read a.go"}) || !reflect.DeepEqual(r.blocks, []bool{false, true}) {
						t.Fatalf("%+v %+v %v", out, r, err)
					}
				}
				b, _ := os.ReadFile(path)
				lines := strings.Split(strings.TrimSpace(string(b)), "\n")
				m := "agent"
				if mode == agents.ModePlan {
					m = "plan"
				}
				server := `"mcpServers":{"faah":{"type":"http","url":"http://localhost/mcp","headers":{"Authorization":"Bearer secret"}}}`
				open := fmt.Sprintf(`{"op":"open","agentId":%q,"options":{"mode":%q,"model":{"id":"chosen"},"name":"faah","local":{"cwd":%q,"settingSources":["project","user","team","mdm","plugins"],"sandboxOptions":{"enabled":true}},%s}}`, resume, m, o.Dir, server)
				send := fmt.Sprintf(`{"op":"send","text":"hello","options":{"mode":%q,"model":{"id":"chosen"},%s}}`, m, server)
				for i, w := range []string{open, send, send} {
					var got, want any
					json.Unmarshal([]byte(lines[i]), &got)
					json.Unmarshal([]byte(w), &want)
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("got %s want %s", lines[i], w)
					}
				}
			})
		}
	}
}

func TestCursorFailure(t *testing.T) {
	for _, tc := range []struct{ prompt, want string }{{"fail", "quota exhausted"}, {"crash", "helper exploded"}} {
		t.Run(tc.prompt, func(t *testing.T) {
			s, _ := fakeSession(t, agents.Open{})
			_, err := s.Prompt(context.Background(), tc.prompt, &recording{})
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatal(err)
			}
		})
	}
}

func TestCursorCancel(t *testing.T) {
	s, _ := fakeSession(t, agents.Open{})
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() { _, err := s.Prompt(context.Background(), "wait", &recording{started: started}); done <- err }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("no turn")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Interrupt(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prompt(ctx, "hello", &recording{}); err != nil {
		t.Fatal(err)
	}
}

func TestCursorOpenFailure(t *testing.T) {
	for _, tc := range []struct{ mode, want string }{{"error", "login required"}, {"crash", "startup failed"}} {
		t.Run(tc.mode, func(t *testing.T) {
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			o := agents.Open{Env: []string{"FAAH_CURSOR_HELPER=1", "FAAH_CURSOR_OPEN=" + tc.mode}}
			if s, err := openHelper(ctx, o, []string{exe}, t.TempDir()); err == nil || !strings.Contains(err.Error(), tc.want) {
				if s != nil {
					s.Close()
				}
				t.Fatal(err)
			}
		})
	}
}

func TestCursorCancelDeadlineStopsHelper(t *testing.T) {
	s, _ := fakeSession(t, agents.Open{})
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := s.Prompt(context.Background(), "ignore-cancel", &recording{started: started})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("no turn")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := s.Interrupt(ctx); err != context.DeadlineExceeded {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("killed helper completed successfully")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("helper did not stop")
	}
}

func TestCursorPromptContextCancel(t *testing.T) {
	s, _ := fakeSession(t, agents.Open{})
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() { _, err := s.Prompt(ctx, "wait", &recording{started: started}); done <- err }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("no turn")
	}
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancel did not complete")
	}
	if _, err := s.Prompt(context.Background(), "hello", &recording{}); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if _, err := s.Prompt(context.Background(), "hello", &recording{}); err == nil {
		t.Fatal("closed session accepted a turn")
	}
}
