package agy

import (
	"bufio"
	"context"
	"encoding/json"
	"faah/internal/agents"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWorkflowQuirk(t *testing.T) {
	for _, v := range []string{"1.4.2", "1.4.3", "1.4.4", "1.4.5"} {
		if !workflowQuirk(v) {
			t.Fatal(v)
		}
	}
	for _, v := range []string{"1.4.1", "1.4.6", "1.5.5", "2.4.3", "unknown"} {
		if workflowQuirk(v) {
			t.Fatal(v)
		}
	}
}

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_AGY_HELPER") != "1" {
		os.Exit(m.Run())
	}
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println("1.5.5")
		os.Exit(0)
	}
	scan := bufio.NewScanner(os.Stdin)
	enc := json.NewEncoder(os.Stdout)
	var prompt json.RawMessage
	permissions := 0
	for scan.Scan() {
		var f struct {
			ID     json.RawMessage
			Method string
			Params map[string]any
		}
		json.Unmarshal(scan.Bytes(), &f)
		result := map[string]any{}
		switch f.Method {
		case "":
			file, _ := os.OpenFile(os.Getenv("FAAH_AGY_MODE_LOG")+".permissions", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			file.Write(append(scan.Bytes(), '\n'))
			file.Close()
			permissions++
			if permissions == 4 {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": prompt, "result": map[string]string{"stopReason": "end_turn"}})
			}
			continue
		case "initialize":
			result["protocolVersion"] = 2
		case "session/new":
			result["sessionId"] = "native"
			result["modes"] = map[string]any{"availableModes": []any{map[string]string{"id": "default"}, map[string]string{"id": "plan"}}}
		case "session/set_mode":
			if f.Params["modeId"] != "default" {
				os.Exit(2)
			}
			os.WriteFile(os.Getenv("FAAH_AGY_MODE_LOG"), []byte("default"), 0600)
			if os.Getenv("FAAH_AGY_MODE_FAIL") == "1" {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "error": map[string]any{"code": -32603, "message": "mode refused"}})
				continue
			}
		case "session/prompt":
			prompt = f.ID
			for index, tool := range []struct{ kind, title string }{{"read", "Read file.go"}, {"execute", "Run shell"}, {"other", "Run mcp_faah_annotate"}, {"other", "Run mcp_other_annotate"}} {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": fmt.Sprint(index), "method": "session/request_permission", "params": map[string]any{"sessionId": "native", "toolCall": map[string]any{"kind": tool.kind, "title": tool.title, "locations": []any{map[string]string{"path": "file.go"}}}, "options": []any{map[string]string{"kind": "allow_once", "optionId": "allow"}, map[string]string{"kind": "reject_once", "optionId": "reject"}}}})
			}
			continue
		}
		enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "result": result})
	}
	os.Exit(0)
}

type silentSink struct{}

func (silentSink) Text(string, bool) {}
func (silentSink) Reasoning(string)  {}
func (silentSink) Step(string)       {}
func (silentSink) Result(string)     {}

func TestAgentAskPermissions(t *testing.T) {
	exe, _ := os.Executable()
	log := filepath.Join(t.TempDir(), "mode")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, err := New().Open(ctx, agents.Open{Dir: t.TempDir(), Mode: agents.ModeAsk, Base: []string{exe}, Env: []string{"FAAH_AGY_HELPER=1", "FAAH_AGY_MODE_LOG=" + log}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp"}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Prompt(ctx, "permissions", silentSink{}); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(log + ".permissions")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	count := 0
	for scanner.Scan() {
		var response struct {
			Result struct {
				Outcome struct{ OptionID string } `json:"outcome"`
			} `json:"result"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		want := "reject"
		if count == 0 || count == 2 {
			want = "allow"
		}
		if response.Result.Outcome.OptionID != want {
			t.Fatalf("permission %d: %s", count, scanner.Bytes())
		}
		count++
	}
	if err := scanner.Err(); err != nil || count != 4 {
		t.Fatal(count, err)
	}
}

func TestAgentAskMode(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			exe, _ := os.Executable()
			log := filepath.Join(t.TempDir(), "mode")
			o := agents.Open{Dir: t.TempDir(), Mode: agents.ModeAsk, Base: []string{exe}, Env: []string{"FAAH_AGY_HELPER=1", "FAAH_AGY_MODE_LOG=" + log}}
			if fail {
				o.Env = append(o.Env, "FAAH_AGY_MODE_FAIL=1")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			s, err := New().Open(ctx, o)
			if fail {
				if err == nil {
					s.Close()
					t.Fatal("Ask opened after mode failure")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				s.Close()
			}
			b, err := os.ReadFile(log)
			if err != nil || string(b) != "default" {
				t.Fatal("native default mode was not set", err)
			}
		})
	}
}
