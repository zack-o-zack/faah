package all

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"faah/internal/agents"
	"faah/internal/agents/cursor"
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

// Every listed adapter has a native protocol contract.
func TestAgentContract(t *testing.T) {
	seen := map[string]bool{}
	for _, a := range List() {
		if seen[a.Name()] || For(a.Name()).Name() != a.Name() {
			t.Fatal(a.Name())
		}
		seen[a.Name()] = true
		t.Run(a.Name(), func(t *testing.T) {
			switch a.Name() {
			case "claude":
				claudeContract(t, a)
			case "codex":
				codexContract(t, a)
			case "agy", "gemini":
				acpContract(t, a)
			case "opencode":
				opencodeContract(t, a)
			case "cursor-agent":
				// Cursor's package exercises the embedded helper with a stub SDK.
				if _, ok := a.(*cursor.Agent); !ok {
					t.Fatal("cursor must use its SDK adapter")
				}
			default:
				t.Fatal("missing native contract")
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
