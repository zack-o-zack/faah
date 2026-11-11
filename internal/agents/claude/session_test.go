package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"faah/internal/agents"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_CLAUDE_HELPER") == "1" {
		if path := os.Getenv("FAAH_HELPER_LOG"); path != "" {
			b, _ := json.Marshal(os.Args[1:])
			os.WriteFile(path+".argv", b, 0600)
		}
		pending := 0
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		for scan.Scan() {
			var f map[string]any
			json.Unmarshal(scan.Bytes(), &f)
			if path := os.Getenv("FAAH_HELPER_LOG"); path != "" {
				file, _ := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
				file.Write(append(scan.Bytes(), '\n'))
				file.Close()
			}
			if f["type"] == "control_response" {
				pending--
				if pending == 0 {
					enc.Encode(map[string]any{"type": "result"})
				}
				continue
			}
			if f["type"] == "control_request" {
				if f["request"].(map[string]any)["subtype"] == "mcp_set_servers" && os.Getenv("FAAH_ATTACH_FAIL") == "1" {
					enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "error", "request_id": f["request_id"], "error": "attachment refused"}})
					continue
				}
				enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": f["request_id"], "response": map[string]any{}}})
			} else if f["type"] == "user" {
				text := f["message"].(map[string]any)["content"].(string)
				if text == "permissions" {
					for i, name := range []string{"Read", "Glob", "Grep", "mcp__faah__annotate", "Bash", "ExitPlanMode"} {
						enc.Encode(map[string]any{"type": "control_request", "request_id": fmt.Sprint(i), "request": map[string]any{"subtype": "can_use_tool", "tool_name": name, "input": map[string]string{"x": "y", "file_path": "file.go", "pattern": "*"}, "tool_use_id": name}})
						pending++
					}
					enc.Encode(map[string]any{"type": "control_request", "request_id": "e", "request": map[string]any{"subtype": "elicitation"}})
					pending++
					enc.Encode(map[string]any{"type": "control_request", "request_id": "u", "request": map[string]any{"subtype": "unknown"}})
					pending++
					continue
				}
				if text == "crash" {
					os.Stderr.WriteString("broken child")
					os.Exit(2)
				}
				if text == "error" {
					enc.Encode(map[string]any{"type": "result", "is_error": true, "result": "bad key"})
					continue
				}
				if text == "split" || text == "messages" {
					for _, id := range []string{"one", "two"} {
						enc.Encode(map[string]any{"type": "stream_event", "event": map[string]any{"type": "message_start", "message": map[string]any{"id": id}}})
						enc.Encode(map[string]any{"type": "stream_event", "event": map[string]any{"type": "content_block_delta", "delta": map[string]any{"type": "text_delta", "text": id}}})
						for _, content := range []any{[]map[string]any{{"type": "thinking", "thinking": "thought"}}, []map[string]any{{"type": "text", "text": id}}, []map[string]any{{"type": "tool_use", "id": "tool-" + id, "name": "Read"}}} {
							enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"id": id, "content": content}})
						}
						enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"id": id, "content": []map[string]any{{"type": "tool_use", "id": "tool-" + id, "name": "Read"}}}})
						if text == "split" {
							break
						}
					}
					enc.Encode(map[string]any{"type": "result"})
					continue
				}

				enc.Encode(map[string]any{"type": "stream_event", "event": map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": "hello"}}})
				enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"content": []map[string]any{{"type": "text", "text": "hello"}, {"type": "tool_use", "name": "Read", "input": map[string]string{"file_path": "a.go"}}}}})
				enc.Encode(map[string]any{"type": "result", "result": "hello"})
			}
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

type capture struct {
	text, reason string
	steps        []string
}

func (c *capture) Text(t string, block bool) {
	if block && c.text != "" {
		c.text += "\n\n"
	}
	c.text += t
}
func (c *capture) Reasoning(t string) { c.reason += t }
func (c *capture) Step(t string)      { c.steps = append(c.steps, t) }
func (c *capture) Result(string)      {}
func TestAgentSessionTurns(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	open := agents.Open{Base: []string{exe}, Mode: agents.ModeAsk, Env: []string{"FAAH_CLAUDE_HELPER=1"}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer secret"}}
	s, err := New().Open(ctx, open)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for i := 0; i < 2; i++ {
		c := &capture{}
		out, err := s.Prompt(ctx, "hi", c)
		if err != nil || out.SessionID != s.ID() || c.text != "hello" || len(c.steps) != 1 {
			t.Fatalf("%+v %+v %v", out, c, err)
		}
	}
	if err = s.Interrupt(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Prompt(ctx, "error", &capture{}); err == nil || !strings.Contains(err.Error(), "bad key") {
		t.Fatal(err)
	}
	open.Resume = s.ID()
	resumed, err := New().Open(ctx, open)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	if resumed.ID() != s.ID() {
		t.Fatal("resume changed id")
	}
	if _, err = resumed.Prompt(ctx, "crash", &capture{}); err == nil || !strings.Contains(err.Error(), "broken child") {
		t.Fatal(err)
	}
}

func TestAgentSessionControlAndArgv(t *testing.T) {
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, mode := range []agents.Mode{agents.ModeAsk, agents.ModeEdit} {
		path := filepath.Join(t.TempDir(), "wire")
		s, err := New().Open(ctx, agents.Open{Base: []string{exe}, Model: "-model", Mode: mode, Env: []string{"FAAH_CLAUDE_HELPER=1", "FAAH_HELPER_LOG=" + path}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer token"}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.Prompt(ctx, "permissions", &capture{}); err != nil {
			t.Fatal(err)
		}
		s.Close()
		wire, _ := os.ReadFile(path)
		lines := strings.Split(strings.TrimSpace(string(wire)), "\n")
		var frames []map[string]any
		for _, line := range lines {
			var f map[string]any
			if json.Unmarshal([]byte(line), &f) != nil {
				t.Fatal(line)
			}
			frames = append(frames, f)
		}
		if frames[0]["request"].(map[string]any)["subtype"] != "initialize" {
			t.Fatal(frames[0])
		}
		request := frames[1]["request"].(map[string]any)
		want := map[string]any{"subtype": "mcp_set_servers", "servers": map[string]any{"faah": map[string]any{"type": "http", "url": "http://localhost/api/mcp", "headers": map[string]any{"Authorization": "Bearer token"}, "timeout": float64(3900000)}}}
		if !reflect.DeepEqual(request, want) {
			t.Fatalf("MCP request: %#v", request)
		}
		if frames[2]["type"] != "user" {
			t.Fatal("prompt preceded registration")
		}
		for i, f := range frames[3:9] {
			response := f["response"].(map[string]any)["response"].(map[string]any)
			behavior := "allow"
			if mode == agents.ModeAsk && i >= 4 {
				behavior = "deny"
			}
			if response["behavior"] != behavior {
				t.Fatalf("permission %d: %v", i, response)
			}
			if behavior == "allow" && !reflect.DeepEqual(response["updatedInput"], map[string]any{"x": "y", "file_path": "file.go", "pattern": "*"}) {
				t.Fatal(response)
			}
		}
		if frames[9]["response"].(map[string]any)["response"].(map[string]any)["action"] != "decline" {
			t.Fatal("elicitation accepted")
		}
		if frames[10]["response"].(map[string]any)["subtype"] != "error" {
			t.Fatal("unknown request accepted")
		}
		argv, _ := os.ReadFile(path + ".argv")
		if !strings.Contains(string(argv), `"--permission-mode","default"`) || strings.Contains(string(argv), `"plan"`) {
			t.Fatal(string(argv))
		}
		if !strings.Contains(string(argv), "--model=-model") {
			t.Fatal(string(argv))
		}
		if mode == agents.ModeAsk && !strings.Contains(string(argv), "Read,Glob,Grep") {
			t.Fatal(string(argv))
		}
	}
}

func TestAgentSessionAttachmentFailure(t *testing.T) {
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := New().Open(ctx, agents.Open{Base: []string{exe}, Env: []string{"FAAH_CLAUDE_HELPER=1", "FAAH_ATTACH_FAIL=1"}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer token"}})
	if err == nil || !strings.Contains(err.Error(), "attachment refused") {
		t.Fatal(err)
	}
}

func TestAskAllowlist(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Fatal(err)
	}
	s := &session{mode: agents.ModeAsk, dir: dir}
	for _, test := range []struct {
		name, input string
		allow       bool
	}{
		{"Read", `{"file_path":"file.go"}`, true},
		{"Glob", `{"pattern":"*.go"}`, true},
		{"Grep", `{"pattern":"func"}`, true},
		{"mcp__faah__annotate", `{}`, true},
		{"mcp__faah__walkthrough", `{}`, true},
		{"Bash", `{"command":"cat file.go"}`, false},
		{"Write", `{"file_path":"file.go"}`, false},
		{"ExitPlanMode", `{}`, false},
		{"mcp__other__read", `{}`, false},
		{"Read", `{"file_path":"../outside.go"}`, false},
		{"Read", `{"file_path":"escape/secret.go"}`, false},
		{"Read", `{}`, false},
		{"Glob", `{"path":"../","pattern":"*"}`, false},
		{"Glob", `{"pattern":"../*"}`, false},
		{"Grep", `{"path":"../","pattern":"func"}`, false},
	} {
		if got := s.allow(test.name, json.RawMessage(test.input)); got != test.allow {
			t.Errorf("%s %s: allowed %v, want %v", test.name, test.input, got, test.allow)
		}
	}
}

func TestClaudeMessageSnapshots(t *testing.T) {
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, err := New().Open(ctx, agents.Open{Base: []string{exe}, Env: []string{"FAAH_CLAUDE_HELPER=1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, tt := range []struct {
		prompt, want string
		steps        int
	}{{"split", "one", 1}, {"messages", "one\n\ntwo", 2}} {
		c := &capture{}
		_, err := s.Prompt(ctx, tt.prompt, c)
		if err != nil || c.text != tt.want || c.reason != "" || len(c.steps) != tt.steps {
			t.Fatalf("%+v %v", c, err)
		}
	}
}
