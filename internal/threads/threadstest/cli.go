package threadstest

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// RunCLIHelper handles the native Claude subprocess used by CLI fixtures.
func RunCLIHelper() {
	if os.Getenv("FAAH_THREAD_CLAUDE_HELPER") == "1" {
		b := strings.Join(os.Args[1:], " ")
		if !strings.Contains(b, "--input-format stream-json") {
			os.Exit(0)
		}
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

				enc.Encode(map[string]any{"type": "assistant", "message": map[string]any{"content": []map[string]any{{"type": "tool_use", "name": "Read", "input": map[string]string{"file_path": "a.go"}}, {"type": "text", "text": "All good."}}}})
				enc.Encode(map[string]any{"type": "result", "result": "All good."})
			}
		}
		os.Exit(0)
	}
}

// CLI puts a script named like a real harness on PATH. It records its
// arguments in the workspace and replies with one line.
func CLI(t *testing.T, name string) {
	t.Helper()
	dir := t.TempDir()
	if name == "claude" {
		exe, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		if err = os.Symlink(exe, filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
		t.Setenv("FAAH_THREAD_CLAUDE_HELPER", "1")
		t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
		return
	}
	body := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + name + "-args.txt\nprintf 'ok\\n'\n"
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}
