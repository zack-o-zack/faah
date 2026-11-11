package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"faah/internal/agents"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_CLAUDE_HELPER") == "1" {
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		for scan.Scan() {
			var f map[string]any
			json.Unmarshal(scan.Bytes(), &f)
			if f["type"] == "control_request" {
				enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": f["request_id"], "response": map[string]any{}}})
			} else if f["type"] == "user" {
				text := f["message"].(map[string]any)["content"].(string)
				if text == "crash" {
					os.Stderr.WriteString("broken child")
					os.Exit(2)
				}
				if text == "error" {
					enc.Encode(map[string]any{"type": "result", "is_error": true, "result": "bad key"})
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

func (c *capture) Text(t string, _ bool) { c.text += t }
func (c *capture) Reasoning(t string)    { c.reason += t }
func (c *capture) Step(t string)         { c.steps = append(c.steps, t) }
func (c *capture) Result(string)         {}
func TestSessionTurns(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exe, _ := os.Executable()
	open := agents.Open{Base: []string{exe}, Mode: agents.ModePlan, Env: []string{"FAAH_CLAUDE_HELPER=1"}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer secret"}}
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
