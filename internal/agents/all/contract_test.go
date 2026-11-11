package all

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/percmd"
)

type sink struct{ text, steps []string }

func (s *sink) Text(t string, _ bool) { s.text = append(s.text, t) }
func (s *sink) Step(t string)         { s.steps = append(s.steps, t) }
func (s *sink) Result(t string)       { s.text = append(s.text, t) }

// fixture is the output each harness's fake prints: for a stream-json
// harness, a session, a tool step and some text. Anything else prints text.
var fixture = map[string][]string{
	"claude": {`{"type":"assistant","session_id":"s1","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.go"}},{"type":"text","text":"hello"}]}}`},
}

// expect is what each listed agent must do. {sid} is the id NewSession
// returned. A follow-up resumes that id, or the id the harness reported when
// it was given none.
type expect struct {
	caps          agents.Caps
	first, resume string // the args the fake receives, joined by spaces
	live          bool   // the session can be resumed after the first turn
	steps         bool   // the output's tool step reaches the sink
}

var contract = map[string]expect{

	"cursor-agent": {caps: agents.Caps{Sessions: true}, live: true,
		first:  "--resume {sid} -p say hello",
		resume: "--resume {sid} -p say hello"},
}

// Every listed agent runs a fake binary of its own name, for a first turn and
// a follow-up, and must match its row in contract.
func TestAgentContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake harness is a shell script")
	}
	seen := map[string]bool{}
	for _, a := range List() {
		a := a
		if a.Name() == "opencode" {
			t.Run("opencode", func(t *testing.T) { opencodeContract(t, a) })
			continue
		}
		if a.Name() == "agy" || a.Name() == "gemini" {
			t.Run(a.Name(), func(t *testing.T) { acpContract(t, a) })
			continue
		}
		if a.Name() == "codex" {
			t.Run("codex", func(t *testing.T) { codexContract(t, a) })
			continue
		}
		if a.Name() == "claude" {
			t.Run("claude", func(t *testing.T) { claudeContract(t, a) })
			continue
		}
		t.Run(a.Name(), func(t *testing.T) {
			want, ok := contract[a.Name()]
			if !ok {
				t.Fatalf("add %s to the contract table", a.Name())
			}
			if seen[a.Name()] {
				t.Fatalf("%s is listed twice", a.Name())
			}
			seen[a.Name()] = true
			if For(a.Name()).Name() != a.Name() {
				t.Fatal("For does not find the listed agent")
			}
			if c := a.(*percmd.Agent).Legacy.Caps(); c.Sessions != want.caps.Sessions || c.NamesSession != want.caps.NamesSession {
				t.Fatalf("caps = %+v, want %+v", c, want.caps)
			}

			dir := t.TempDir()
			lines := fixture[a.Name()]
			if lines == nil {
				lines = []string{"hello"}
			}
			bin := filepath.Join(dir, a.Name())
			script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > args.txt\nprintf '%s\\n' '" + strings.Join(lines, "' '") + "'\n"
			if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			argv := []string{bin, "-p", "{prompt}"}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			args := func() string {
				b, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				return strings.Join(strings.Fields(string(b)), " ")
			}

			session, err := a.Open(ctx, agents.Open{Dir: dir, Base: argv})
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			sid := session.ID()
			s := &sink{}
			out, err := session.Prompt(ctx, "say hello", s)
			if err != nil {
				t.Fatal(err)
			}

			if got, w := args(), strings.ReplaceAll(want.first, "{sid}", sid); got != w {
				t.Fatalf("first turn args = %q, want %q", got, w)
			}
			if !strings.Contains(strings.Join(s.text, ""), "hello") {
				t.Fatalf("text = %q", s.text)
			}
			if out.Live != want.live {
				t.Fatalf("live = %v, want %v", out.Live, want.live)
			}
			if want.steps != (len(s.steps) > 0) {
				t.Fatalf("steps = %q, want some: %v", s.steps, want.steps)
			}

			if _, err := session.Prompt(ctx, "say hello", &sink{}); err != nil {
				t.Fatal(err)
			}

			expected := strings.ReplaceAll(want.resume, "{sid}", sid)
			if !want.caps.Sessions {
				expected = "-p ### Earlier in this conversation User: say hello Assistant: hello ### Current request say hello"
			}
			if got, w := args(), expected; got != w {
				t.Fatalf("follow-up args = %q, want %q", got, w)
			}
			if strings.Join(argv, " ") != bin+" -p {prompt}" {
				t.Fatalf("Run changed its argv: %q", argv)
			}

			if _, _, err := a.(*percmd.Agent).Legacy.ReadOnly(argv); err != nil && !strings.Contains(err.Error(), agents.ErrNotReadOnly.Error()) {
				t.Fatalf("ReadOnly error must wrap ErrNotReadOnly: %v", err)
			}
		})
	}
}

func (s *sink) Reasoning(text string) {}

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_CONTRACT_OPENCODE") == "1" {
		serveOpenCodeContract()
		os.Exit(0)
	}
	if os.Getenv("FAAH_CONTRACT_ACP") == "1" {
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		for scan.Scan() {
			var f map[string]any
			json.Unmarshal(scan.Bytes(), &f)
			r := map[string]any{}
			switch f["method"] {
			case "initialize":
				r["protocolVersion"] = 1
			case "session/new":
				r["sessionId"] = "native"
			case "session/prompt":
				enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "native", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "hello"}}}})
				r["stopReason"] = "end_turn"
			}
			enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f["id"], "result": r})
		}
		os.Exit(0)
	}

	if os.Getenv("FAAH_CONTRACT_CODEX") == "1" {
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		for scan.Scan() {
			var f map[string]any
			json.Unmarshal(scan.Bytes(), &f)
			switch f["method"] {
			case "initialize":
				enc.Encode(map[string]any{"id": f["id"], "result": map[string]any{}})
			case "thread/start", "thread/resume":
				enc.Encode(map[string]any{"id": f["id"], "result": map[string]any{"model": "test-model", "thread": map[string]string{"id": "native"}}})
			case "turn/start":
				enc.Encode(map[string]any{"id": f["id"], "result": map[string]any{"turn": map[string]string{"id": "turn"}}})
				enc.Encode(map[string]any{"method": "item/agentMessage/delta", "params": map[string]string{"threadId": "native", "turnId": "turn", "delta": "hello"}})
				enc.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": "native", "turn": map[string]string{"id": "turn", "status": "completed"}}})
			}
		}
		os.Exit(0)
	}
	if os.Getenv("FAAH_CONTRACT_CLAUDE") == "1" {
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		for scan.Scan() {
			var f map[string]any
			json.Unmarshal(scan.Bytes(), &f)
			if f["type"] == "control_request" {
				enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": f["request_id"], "response": map[string]any{}}})
			}
			if f["type"] == "user" {
				for _, line := range fixture["claude"] {
					os.Stdout.WriteString(line + "\n")
				}
				enc.Encode(map[string]any{"type": "result"})
			}
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}
func claudeContract(t *testing.T, a agents.Agent) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	session, err := a.Open(ctx, agents.Open{Base: []string{exe}, Env: []string{"FAAH_CONTRACT_CLAUDE=1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	id := session.ID()
	if id == "" {
		t.Fatal("missing native id")
	}
	for i := 0; i < 2; i++ {
		sink := &sink{}
		out, err := session.Prompt(ctx, "say hello", sink)
		if err != nil || out.SessionID != id || strings.Join(sink.text, "") != "hello" || len(sink.steps) != 1 {
			t.Fatalf("%+v %+v %v", out, sink, err)
		}
	}
}

func codexContract(t *testing.T, a agents.Agent) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	o := agents.Open{Base: []string{exe}, Env: []string{"FAAH_CONTRACT_CODEX=1"}}
	s, err := a.Open(ctx, o)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 2; i++ {
		c := &sink{}
		out, err := s.Prompt(ctx, "hello", c)
		if err != nil || !out.Live || out.SessionID != "native" || strings.Join(c.text, "") != "hello" {
			t.Fatalf("%+v %+v %v", out, c, err)
		}
	}
}

func acpContract(t *testing.T, a agents.Agent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	s, err := a.Open(ctx, agents.Open{Base: []string{exe}, Env: []string{"FAAH_CONTRACT_ACP=1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	for i := 0; i < 2; i++ {
		c := &sink{}
		out, err := s.Prompt(ctx, "hello", c)
		if err != nil || out.SessionID != "native" || strings.Join(c.text, "") != "hello" {
			t.Fatalf("%+v %+v %v", out, c, err)
		}
	}
}

func serveOpenCodeContract() {
	port := ""
	for _, arg := range os.Args {
		if strings.HasPrefix(arg, "--port=") {
			port = strings.TrimPrefix(arg, "--port=")
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		os.Exit(2)
	}
	var mu sync.Mutex
	var events chan string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pw, ok := r.BasicAuth()
		if !ok || user != "opencode" || pw != os.Getenv("OPENCODE_PASSWORD") {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.URL.Path == "/api/event":
			ch := make(chan string, 16)
			mu.Lock()
			events = ch
			mu.Unlock()
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			for {
				select {
				case e := <-ch:
					fmt.Fprintf(w, "data: %s\n\n", e)
					w.(http.Flusher).Flush()
				case <-r.Context().Done():
					return
				}
			}
		case r.URL.Path == "/api/session":
			fmt.Fprintln(w, `{"data":{"id":"ses_native","agent":"build"}}`)
		case strings.HasSuffix(r.URL.Path, "/prompt"):
			mu.Lock()
			ch := events
			mu.Unlock()
			ch <- `{"type":"session.text.delta","data":{"sessionID":"ses_native","id":"part","delta":"hello"}}`
			ch <- `{"type":"session.execution.succeeded","data":{"sessionID":"ses_native"}}`
			w.WriteHeader(204)
		default:
			w.WriteHeader(204)
		}
	})
	fmt.Fprintf(os.Stdout, "server listening on http://%s\n", listener.Addr())
	http.Serve(listener, handler)
}

func opencodeContract(t *testing.T, a agents.Agent) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	s, err := a.Open(ctx, agents.Open{Base: []string{exe}, Dir: t.TempDir(), Env: []string{"FAAH_CONTRACT_OPENCODE=1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 2; i++ {
		c := &sink{}
		out, err := s.Prompt(ctx, "hello", c)
		if err != nil || out.SessionID != "ses_native" || !out.Live || strings.Join(c.text, "") != "hello" {
			t.Fatalf("%+v %+v %v", out, c, err)
		}
	}
}
