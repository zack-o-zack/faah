package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "acp-mcp-bridge" {
		os.Exit(runACPBridge())
	}
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

func TestACPBridgeTestBinary(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer bridge-test" {
			t.Error("missing authorization")
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Mcp-Session-Id", "bridge-session")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}`))
	}))
	defer server.Close()
	exe, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "acp-mcp-bridge")
	cmd.Env = append(os.Environ(), "FAAH_ACP_MCP_ENDPOINT="+server.URL, "FAAH_ACP_MCP_AUTHORIZATION=Bearer bridge-test")
	cmd.Stdin = strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}` + "\n")
	b, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(b), `"protocolVersion":"2025-06-18"`) {
		t.Fatalf("bridge: %s %v", b, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("bridge made %d calls", calls.Load())
	}
}
