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
	for scan.Scan() {
		var f struct {
			ID     json.RawMessage
			Method string
			Params map[string]any
		}
		json.Unmarshal(scan.Bytes(), &f)
		result := map[string]any{}
		switch f.Method {
		case "initialize":
			result["protocolVersion"] = 2
		case "session/new":
			result["sessionId"] = "native"
			result["modes"] = map[string]any{"availableModes": []any{map[string]string{"id": "plan"}}}
		case "session/set_mode":
			if f.Params["modeId"] != "plan" {
				os.Exit(2)
			}
			os.WriteFile(os.Getenv("FAAH_AGY_MODE_LOG"), []byte("plan"), 0600)
			if os.Getenv("FAAH_AGY_MODE_FAIL") == "1" {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "error": map[string]any{"code": -32603, "message": "mode refused"}})
				continue
			}
		}
		enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "result": result})
	}
	os.Exit(0)
}

func TestAgentPlanMode(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			exe, _ := os.Executable()
			log := filepath.Join(t.TempDir(), "mode")
			o := agents.Open{Dir: t.TempDir(), Mode: agents.ModePlan, Base: []string{exe}, Env: []string{"FAAH_AGY_HELPER=1", "FAAH_AGY_MODE_LOG=" + log}}
			if fail {
				o.Env = append(o.Env, "FAAH_AGY_MODE_FAIL=1")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			s, err := New().Open(ctx, o)
			if fail {
				if err == nil {
					s.Close()
					t.Fatal("Plan opened after mode failure")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				s.Close()
			}
			b, err := os.ReadFile(log)
			if err != nil || string(b) != "plan" {
				t.Fatal("native Plan was not set", err)
			}
		})
	}
}
