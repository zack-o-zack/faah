package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBridgeServerAndEOF(t *testing.T) {
	s, tok := testServer()
	ts := httptest.NewServer(s)
	defer ts.Close()
	input := strings.Join([]string{`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`, `{"jsonrpc":"2.0","method":"notifications/initialized"}`, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"x":1}}}`}, "\n")
	var out bytes.Buffer
	if err := Bridge(context.Background(), strings.NewReader(input), &out, ts.URL, "Bearer "+tok); err != nil {
		t.Fatal(err)
	}
	frames := map[int]map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var f map[string]any
		if err := json.Unmarshal([]byte(line), &f); err != nil {
			t.Fatal(err)
		}
		if f["error"] != nil {
			t.Fatal(f)
		}
		frames[int(f["id"].(float64))] = f
	}
	if len(frames) != 3 || frames[1]["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Fatal(frames)
	}
	if frames[2]["result"].(map[string]any)["tools"].([]any)[0].(map[string]any)["name"] != "echo" {
		t.Fatal(frames)
	}
	if frames[3]["result"].(map[string]any)["content"].([]any)[0].(map[string]any)["text"] != `t1:{"x":1}` {
		t.Fatal(frames)
	}
}

func TestBridgeFailures(t *testing.T) {
	s, _ := testServer()
	ts := httptest.NewServer(s)
	defer ts.Close()
	for _, input := range []string{`{"id":1,"method":"initialize"}`, `invalid`} {
		var out bytes.Buffer
		if err := Bridge(context.Background(), strings.NewReader(input), &out, ts.URL, "Bearer wrong"); err != nil {
			t.Fatal(err)
		}
		var f struct {
			Error struct {
				Code    int
				Message string
			}
		}
		if err := json.Unmarshal(out.Bytes(), &f); err != nil {
			t.Fatal(err)
		}
		if input == "invalid" {
			if f.Error.Code != -32700 {
				t.Fatal(out.String())
			}
		} else if !strings.Contains(f.Error.Message, "401") {
			t.Fatal(out.String())
		}
	}
}

func TestBridgeSSEAndTransportFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n")
	}))
	var out bytes.Buffer
	if err := Bridge(context.Background(), strings.NewReader(`{"id":1,"method":"initialize"}`), &out, ts.URL, ""); err != nil || !json.Valid(bytes.TrimSpace(out.Bytes())) {
		t.Fatal(out.String(), err)
	}
	ts.Close()
	out.Reset()
	if err := Bridge(context.Background(), strings.NewReader(`{"id":2,"method":"tools/list"}`), &out, ts.URL, ""); err != nil || !strings.Contains(out.String(), `"error"`) {
		t.Fatal(out.String(), err)
	}
}

func TestBridgeNegotiationAndConcurrentCalls(t *testing.T) {
	var ready bool
	var mu sync.Mutex
	arrived := make(chan struct{})
	count := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Error("unexpected method", r.Method)
		}
		var q struct {
			ID     int
			Method string
		}
		json.NewDecoder(r.Body).Decode(&q)
		if q.Method == "initialize" {
			mu.Lock()
			ready = true
			mu.Unlock()
			w.Header().Set("Mcp-Session-Id", "bridge-session")
			fmt.Fprint(w, `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}`)
			return
		}
		mu.Lock()
		negotiated := ready
		mu.Unlock()
		if !negotiated || r.Header.Get("Mcp-Session-Id") != "bridge-session" || r.Header.Get("MCP-Protocol-Version") != "2025-06-18" {
			t.Error("missing negotiation", r.Header)
		}
		mu.Lock()
		count++
		if count == 2 {
			close(arrived)
		}
		mu.Unlock()
		select {
		case <-arrived:
		case <-r.Context().Done():
			return
		}
		fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%d,"result":{}}`, q.ID)
	}))
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var out bytes.Buffer
	if err := Bridge(ctx, strings.NewReader("{\"id\":2,\"method\":\"ping\"}\n{\"id\":1,\"method\":\"initialize\"}\n{\"id\":3,\"method\":\"ping\"}"), &out, ts.URL, ""); err != nil {
		t.Fatal(err)
	}
	if strings.Count(out.String(), "\n") != 3 || strings.Contains(out.String(), `"error"`) {
		t.Fatal(out.String())
	}
}
