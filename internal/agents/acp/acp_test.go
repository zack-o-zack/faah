package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

func TestMain(m *testing.M) {
	if os.Getenv("FAAH_ACP_HELPER") != "1" {
		os.Exit(m.Run())
	}
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println("1.5.5")
		os.Exit(0)
	}
	log, _ := os.OpenFile(os.Getenv("FAAH_ACP_LOG"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	defer log.Close()
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	emit := func(update any) {
		enc.Encode(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "native", "update": update}})
	}
	pending := json.RawMessage(nil)
	count := 0
	authenticated := false
	var held json.RawMessage
	for scan.Scan() {
		log.Write(append(append([]byte(nil), scan.Bytes()...), '\n'))
		var f frame
		json.Unmarshal(scan.Bytes(), &f)
		respond := func(r any) { enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "result": r}) }
		switch f.Method {
		case "initialize":
			caps := map[string]any{"loadSession": true, "mcpCapabilities": map[string]bool{"http": os.Getenv("FAAH_ACP_HTTP") == "1"}}
			if os.Getenv("FAAH_ACP_LOAD") != "1" {
				caps["sessionCapabilities"] = map[string]any{"resume": map[string]any{}}
			}
			respond(map[string]any{"protocolVersion": 1, "agentCapabilities": caps, "authMethods": []any{map[string]string{"id": "test-auth", "type": "agent"}}})
		case "authenticate":
			authenticated = true
			respond(map[string]any{})
		case "session/new", "session/resume", "session/load":
			if os.Getenv("FAAH_ACP_AUTH") == "1" && !authenticated {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "error": map[string]any{"code": -32000, "message": "Authentication required"}})
				continue
			}
			if f.Method == "session/load" {
				emit(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "replay"}})
			}
			setup := map[string]any{"sessionId": "native", "configOptions": []any{map[string]string{"id": "model-choice", "category": "model", "type": "select"}}, "modes": map[string]any{"availableModes": []any{map[string]string{"id": "plan"}}}}
			if os.Getenv("FAAH_ACP_LEGACY_MODEL") == "1" {
				delete(setup, "configOptions")
				setup["models"] = map[string]any{"availableModels": []any{map[string]string{"modelId": "test-model"}}}
			}
			respond(setup)
		case "session/set_config_option", "session/set_mode", "session/set_model":
			if f.Method == "session/set_mode" && os.Getenv("FAAH_ACP_MODE_FAIL") == "1" {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "error": map[string]any{"code": -32603, "message": "mode failed"}})
				continue
			}
			respond(map[string]any{})
		case "session/prompt":
			var p struct{ Prompt []struct{ Text string } }
			json.Unmarshal(f.Params, &p)
			text := p.Prompt[0].Text
			if text == "crash" {
				fmt.Fprint(os.Stderr, "fake ACP crash")
				os.Exit(2)
			}
			if text == "hold" || text == "cancel" {
				held = f.ID
				continue
			}
			if text == "permissions" {
				pending = f.ID
				kinds := []string{"read", "search", "think", "fetch", "edit", "execute", "edit"}
				for i, k := range kinds {
					locations := []any{}
					if i == 4 {
						locations = append(locations, map[string]string{"path": "new.go"})
					}
					if i == 6 {
						locations = append(locations, map[string]string{"path": filepath.Join(os.TempDir(), "outside.go")})
					}
					enc.Encode(map[string]any{"jsonrpc": "2.0", "id": fmt.Sprintf("perm-%d", i), "method": "session/request_permission", "params": map[string]any{"sessionId": "native", "toolCall": map[string]any{"kind": k, "locations": locations}, "options": []any{map[string]string{"kind": "allow_once", "optionId": "yes"}, map[string]string{"kind": "reject_once", "optionId": "no"}}}})
				}
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": "unknown", "method": "fs/read_text_file", "params": map[string]any{}})
				continue
			}
			if text == "rpc-error" {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": f.ID, "error": map[string]any{"code": -32603, "message": "prompt failed"}})
				continue
			}
			if text == "refusal" {
				respond(map[string]string{"stopReason": "refusal"})
				continue
			}
			for _, id := range []string{"one", "one", "two"} {
				emit(map[string]any{"sessionUpdate": "agent_message_chunk", "messageId": id, "content": map[string]string{"type": "text", "text": "hello"}})
			}
			emit(map[string]any{"sessionUpdate": "agent_thought_chunk", "content": map[string]string{"type": "text", "text": "thinking"}})
			for i := 0; i < 2; i++ {
				emit(map[string]string{"sessionUpdate": "tool_call", "toolCallId": "tool", "title": "Read file"})
			}
			if text == "separated" {
				emit(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "after tool"}})
			}
			respond(map[string]string{"stopReason": "end_turn"})
		case "session/cancel":
			if os.Getenv("FAAH_ACP_CANCEL") == "1" {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": held, "result": map[string]string{"stopReason": "cancelled"}})
			}
		case "":
			count++
			if count == 8 {
				enc.Encode(map[string]any{"jsonrpc": "2.0", "id": pending, "result": map[string]string{"stopReason": "end_turn"}})
			}
		}
	}
	os.Exit(0)
}

type capture struct {
	text, reason string
	steps        []string
	blocks       []bool
}

func (c *capture) Text(t string, b bool) { c.text += t; c.blocks = append(c.blocks, b) }

func (c *capture) Reasoning(t string) { c.reason += t }

func (c *capture) Step(t string) { c.steps = append(c.steps, t) }

func (*capture) Result(string) {}

func setup(t *testing.T) (context.Context, agents.Open, []string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	exe, _ := os.Executable()
	o := agents.Open{Dir: t.TempDir(), Version: "1.2.3", Model: "test-model", Env: []string{"FAAH_ACP_HELPER=1", "FAAH_ACP_LOG=" + filepath.Join(t.TempDir(), "wire")}, Tools: &agents.ToolEndpoint{URL: "http://localhost/api/mcp", Authorization: "Bearer test"}}
	return ctx, o, []string{exe}
}

func wire(t *testing.T, o agents.Open) []map[string]any {
	t.Helper()
	b, err := os.ReadFile(strings.TrimPrefix(o.Env[1], "FAAH_ACP_LOG="))
	if err != nil {
		t.Fatal(err)
	}
	var result []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var f map[string]any
		if err = json.Unmarshal([]byte(line), &f); err != nil {
			t.Fatal(err)
		}
		if f["jsonrpc"] != "2.0" {
			t.Fatal(f)
		}
		result = append(result, f)
	}
	return result
}

func TestACPHandshakeResumeAndStreaming(t *testing.T) {
	for _, http := range []bool{false, true} {
		for _, load := range []bool{false, true} {
			t.Run(fmt.Sprint(http, load), func(t *testing.T) {
				ctx, o, argv := setup(t)
				if http {
					o.Env = append(o.Env, "FAAH_ACP_HTTP=1")
				}
				if load {
					o.Env = append(o.Env, "FAAH_ACP_LOAD=1")
				}
				o.Mode = agents.ModePlan
				for i := 0; i < 2; i++ {
					s, err := Open(ctx, o, argv, nil, nil, true)
					if err != nil {
						t.Fatal(err)
					}
					c := &capture{}
					out, err := s.Prompt(ctx, "hello", c)
					if err != nil || out.SessionID != "native" || c.text != "hellohellohello" || c.reason != "thinking" || !reflect.DeepEqual(c.steps, []string{"Read file"}) || !reflect.DeepEqual(c.blocks, []bool{false, false, true}) {
						t.Fatalf("%+v %+v %v", out, c, err)
					}
					if _, err = s.Prompt(ctx, "refusal", &capture{}); err == nil {
						t.Fatal("refusal accepted")
					}
					s.Close()
					o.Resume = s.ID()
				}
				frames := wire(t, o)
				init := frames[0]["params"].(map[string]any)
				want := map[string]any{"protocolVersion": float64(2), "clientCapabilities": map[string]any{"fs": map[string]any{"readTextFile": false, "writeTextFile": false}, "terminal": false}, "clientInfo": map[string]any{"name": "faah", "title": "faah", "version": "1.2.3"}}
				if !reflect.DeepEqual(init, want) {
					t.Fatal(init)
				}
				exe, _ := os.Executable()
				var expected any = map[string]any{"name": "faah", "command": exe, "args": []any{"acp-mcp-bridge"}, "env": []any{map[string]any{"name": "FAAH_ACP_MCP_ENDPOINT", "value": o.Tools.URL}, map[string]any{"name": "FAAH_ACP_MCP_AUTHORIZATION", "value": o.Tools.Authorization}}}
				if http {
					expected = map[string]any{"type": "http", "name": "faah", "url": o.Tools.URL, "headers": []any{map[string]any{"name": "Authorization", "value": o.Tools.Authorization}}}
				}
				found := false
				model, mode := false, false
				for _, f := range frames {
					p, _ := f["params"].(map[string]any)
					switch f["method"] {
					case "session/new", "session/load", "session/resume":
						if !reflect.DeepEqual(p["mcpServers"], []any{expected}) || p["cwd"] != o.Dir {
							t.Fatal(p)
						}
						if f["method"] != "session/new" {
							want := "session/resume"
							if load {
								want = "session/load"
							}
							if f["method"] != want {
								t.Fatal(f)
							}
							found = true
						}
					case "session/set_config_option":
						model = p["configId"] == "model-choice" && p["value"] == o.Model
					case "session/set_mode":
						mode = p["modeId"] == "plan"
					}
				}
				if !found || !model || !mode {
					t.Fatal(found, model, mode)
				}
			})
		}
	}
}

func TestACPPermissions(t *testing.T) {
	for _, mode := range []agents.Mode{agents.ModePlan, agents.ModeEdit} {
		t.Run(fmt.Sprint(mode), func(t *testing.T) {
			ctx, o, argv := setup(t)
			o.Mode = mode
			o.Tools = nil
			o.Model = ""
			s, err := Open(ctx, o, argv, nil, nil, false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if _, err = s.Prompt(ctx, "permissions", &capture{}); err != nil {
				t.Fatal(err)
			}
			for _, f := range wire(t, o) {
				id, _ := f["id"].(string)
				if strings.HasPrefix(id, "perm-") {
					var i int
					fmt.Sscanf(id, "perm-%d", &i)
					want := "yes"
					if i == 6 || mode == agents.ModePlan && i >= 4 {
						want = "no"
					}
					r := f["result"].(map[string]any)["outcome"].(map[string]any)
					if r["optionId"] != want || r["outcome"] != "selected" {
						t.Fatal(f)
					}
				}
				if id == "unknown" && f["error"] == nil {
					t.Fatal(f)
				}
				if f["method"] == "session/new" && len(f["params"].(map[string]any)["mcpServers"].([]any)) != 0 {
					t.Fatal(f)
				}
			}
		})
	}
}

func TestACPCrashAndCancel(t *testing.T) {
	for _, text := range []string{"crash", "hold"} {
		t.Run(text, func(t *testing.T) {
			ctx, o, argv := setup(t)
			s, err := Open(ctx, o, argv, nil, nil, false)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			if text == "crash" {
				_, err = s.Prompt(ctx, text, &capture{})
				if err == nil || !strings.Contains(err.Error(), "fake ACP crash") {
					t.Fatal(err)
				}
				return
			}
			done := make(chan error, 1)
			go func() { _, err := s.Prompt(ctx, text, &capture{}); done <- err }()
			deadline := time.Now().Add(time.Second)
			for {
				ss := s.(*session)
				ss.mu.Lock()
				ready := ss.active != nil
				ss.mu.Unlock()
				if ready {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("prompt did not start")
				}
				time.Sleep(time.Millisecond)
			}
			err = s.Interrupt(ctx)
			want := "The agent did not finish cancelling. Its process was stopped."
			if err == nil || err.Error() != want {
				t.Fatal(err)
			}
			if err = <-done; err == nil || err.Error() != want {
				t.Fatal(err)
			}
			select {
			case <-s.(*session).p.Exited:
			case <-ctx.Done():
				t.Fatal("process did not exit")
			}
		})
	}
}

func TestACPContainment(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Skip(err)
	}
	for _, p := range []string{"../escape", filepath.Join(outside, "new"), "link/new"} {
		if inside(dir, p) {
			t.Fatal(p)
		}
	}
	if !inside(dir, "new/sub/file") {
		t.Fatal("new path refused")
	}
}

func TestACPArgs(t *testing.T) {
	for _, name := range []string{"agy", "gemini"} {
		got := Args([]string{name, "-p", "{prompt}", "--output-format", "stream-json", "--mode", "plan", "--conversation", "old", "--unknown", "--sandbox"}, name)
		sub := "--acp"
		if name == "agy" {
			sub = "acp"
		}
		if !reflect.DeepEqual(got, []string{name, sub, "--sandbox"}) {
			t.Fatal(got)
		}
	}
}

func TestACPAuthAndLegacyModel(t *testing.T) {
	ctx, o, argv := setup(t)
	o.Env = append(o.Env, "FAAH_ACP_AUTH=1", "FAAH_ACP_LEGACY_MODEL=1")
	s, err := Open(ctx, o, argv, nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err = s.Prompt(ctx, "rpc-error", &capture{}); err == nil || err.Error() != "prompt failed" {
		t.Fatal(err)
	}
	auth, model := false, false
	for _, f := range wire(t, o) {
		p, _ := f["params"].(map[string]any)
		if f["method"] == "authenticate" {
			auth = p["methodId"] == "test-auth"
		}
		if f["method"] == "session/set_model" {
			model = p["modelId"] == o.Model
		}
	}
	if !auth || !model {
		t.Fatal(auth, model)
	}
}

func TestACPGracefulCancel(t *testing.T) {
	ctx, o, argv := setup(t)
	o.Env = append(o.Env, "FAAH_ACP_CANCEL=1")
	s, err := Open(ctx, o, argv, nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	turnCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if _, err = s.Prompt(turnCtx, "cancel", &capture{}); err != context.DeadlineExceeded {
		t.Fatal(err)
	}
	if _, err = s.Prompt(ctx, "hello", &capture{}); err != nil {
		t.Fatal(err)
	}
}

func TestACPMessageAfterTool(t *testing.T) {
	ctx, o, argv := setup(t)
	s, err := Open(ctx, o, argv, nil, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	c := &capture{}
	if _, err = s.Prompt(ctx, "separated", c); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(c.blocks, []bool{false, false, true, true}) {
		t.Fatal(c.blocks)
	}
}

func TestACPPlanModeFailure(t *testing.T) {
	ctx, o, argv := setup(t)
	o.Mode = agents.ModePlan
	o.Env = append(o.Env, "FAAH_ACP_MODE_FAIL=1")
	s, err := Open(ctx, o, argv, nil, nil, true)
	if err == nil {
		s.Close()
		t.Fatal("Plan opened after set_mode failed")
	}
	if !strings.Contains(err.Error(), "mode failed") {
		t.Fatal(err)
	}
}
