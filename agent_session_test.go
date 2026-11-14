package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"faah/internal/threads/threadstest"
)

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

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "acp-mcp-bridge" {
		os.Exit(runACPBridge())
	}
	threadstest.RunCLIHelper()
	os.Exit(m.Run())
}
