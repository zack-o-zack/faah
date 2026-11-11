package main

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_THREAD_CLAUDE_HELPER") == "1" {
		b := strings.Join(os.Args[1:], " ")
		os.WriteFile("claude-args.txt", []byte(b), 0600)
		f, _ := os.OpenFile("claude-runs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		f.WriteString(b + "\n")
		f.Close()
		scan := bufio.NewScanner(os.Stdin)
		enc := json.NewEncoder(os.Stdout)
		var endpoint struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		}
		for scan.Scan() {
			var frame map[string]any
			json.Unmarshal(scan.Bytes(), &frame)
			switch frame["type"] {
			case "control_request":
				if request, ok := frame["request"].(map[string]any); ok && request["subtype"] == "mcp_set_servers" {
					data, _ := json.Marshal(request["servers"].(map[string]any)["faah"])
					json.Unmarshal(data, &endpoint)
				}
				enc.Encode(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": frame["request_id"], "response": map[string]any{}}})
			case "user":
				if script := os.Getenv("FAAH_EXPLAIN_SCRIPT"); script != "" {
					prompt := frame["message"].(map[string]any)["content"].(string)
					argv := append([]string{script}, os.Args[1:]...)
					argv = append(argv, prompt)
					cmd := exec.Command("/bin/sh", argv...)
					cmd.Env = append(os.Environ(), "FAAH_TEST_MCP_URL="+endpoint.URL, "FAAH_TEST_MCP_TOKEN="+strings.TrimPrefix(endpoint.Headers["Authorization"], "Bearer "))
					output, err := cmd.CombinedOutput()
					enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"id": "answer", "content": []map[string]string{{"type": "text", "text": string(output)}}}})
					enc.Encode(map[string]any{"type": "result", "is_error": err != nil, "result": string(output)})
					continue
				}

				enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"content": []map[string]any{{"type": "tool_use", "name": "Read", "input": map[string]string{"file_path": "a.go"}}, {"type": "text", "text": "All good."}}}})
				enc.Encode(map[string]any{"type": "result", "result": "All good."})
			}
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestThreadSessionIdleResumes(t *testing.T) {
	root := t.TempDir()
	fakeCLI(t, "claude")
	s := agentServer(t, root, "claude -p {prompt}")
	s.threads.sessionIdle = 15 * time.Millisecond
	_, m := agentPostJSON(t, s, "/api/threads/create", map[string]any{"message": "hello"})
	id := m["id"].(string)
	waitThreadIdle(t, s, id)
	deadline := time.Now().Add(3 * time.Second)
	for {
		s.threads.mu.Lock()
		live := s.threads.sessions[id] != nil
		s.threads.mu.Unlock()
		if !live {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("session stayed open")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := s.threads.Send(id, "follow up"); err != nil {
		t.Fatal(err)
	}
	th := waitThreadIdle(t, s, id)
	b, _ := os.ReadFile(filepath.Join(root, "claude-runs.txt"))
	if !strings.Contains(string(b), "--resume "+th.SessionID) || len(strings.Split(strings.TrimSpace(string(b)), "\n")) != 2 {
		t.Fatalf("process args: %s", b)
	}
}
