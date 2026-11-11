package cursor

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

func stubSession(t *testing.T, resume, key string) (agents.Session, string) {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is not installed")
	}
	dir := t.TempDir()
	mod := filepath.Join(dir, "node_modules", "@cursor", "sdk")
	if err := os.MkdirAll(mod, 0700); err != nil {
		t.Fatal(err)
	}
	for path, data := range map[string][]byte{
		filepath.Join(mod, "package.json"): []byte(`{"type":"module","exports":"./index.mjs"}`),
		filepath.Join(mod, "index.mjs"):    []byte(stubSDK),
		filepath.Join(dir, "helper.mjs"):   helper,
	} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	o := agents.Open{Dir: dir, Resume: resume, Mode: agents.ModePlan, Model: "test", Env: []string{"CURSOR_API_KEY=" + key}, Tools: &agents.ToolEndpoint{URL: "http://local/mcp", Authorization: "Bearer stub"}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := openHelper(ctx, o, []string{node, "helper.mjs"}, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, dir
}

func sdkCalls(t *testing.T, dir string) []map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "calls"))
	if err != nil {
		t.Fatal(err)
	}
	var calls []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var call map[string]any
		if err := json.Unmarshal([]byte(line), &call); err != nil {
			t.Fatal(err)
		}
		calls = append(calls, call)
	}
	return calls
}

func TestCursorHelperSDK(t *testing.T) {
	for _, resume := range []string{"", "previous"} {
		for _, key := range []string{"", "stub-key"} {
			t.Run(resume+key, func(t *testing.T) {
				s, dir := stubSession(t, resume, key)
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				for i := 0; i < 2; i++ {
					r := &recording{}
					if _, err := s.Prompt(ctx, "hello", r); err != nil {
						t.Fatal(err)
					}
					if strings.Join(r.text, "") != "helloagain" || strings.Join(r.reasoning, "") != "think" || !reflect.DeepEqual(r.steps, []string{"read a.go"}) || !reflect.DeepEqual(r.blocks, []bool{false, true}) {
						t.Fatalf("%+v", r)
					}
				}
				s.Close()
				calls := sdkCalls(t, dir)
				method := "create"
				if resume != "" {
					method = "resume"
				}
				if calls[0]["method"] != method || (resume != "" && calls[0]["id"] != resume) {
					t.Fatal(calls[0])
				}
				want := map[string]any{
					"mode": "plan", "model": map[string]any{"id": "test"},
					"mcpServers": map[string]any{"faah": map[string]any{"type": "http", "url": "http://local/mcp", "headers": map[string]any{"Authorization": "Bearer stub"}}},
				}
				wantOpen := map[string]any{}
				for k, v := range want {
					wantOpen[k] = v
				}
				wantOpen["name"] = "faah"
				wantOpen["local"] = map[string]any{"cwd": dir, "settingSources": []any{"project", "user", "team", "mdm", "plugins"}, "sandboxOptions": map[string]any{"enabled": true}}
				if key != "" {
					wantOpen["apiKey"] = key
				}
				if !reflect.DeepEqual(calls[0]["options"], wantOpen) {
					t.Fatalf("open = %#v, want %#v", calls[0], wantOpen)
				}
				counts := map[string]int{}
				for _, call := range calls {
					m := call["method"].(string)
					counts[m]++
					switch m {
					case "send":
						if call["text"] != "hello" || call["onDelta"] != true || !reflect.DeepEqual(call["options"], want) {
							t.Fatal(call)
						}
					case "listRuns", "cancelRun":
						opts := map[string]any{"runtime": "local", "cwd": dir}
						if m == "listRuns" {
							opts["limit"] = float64(1)
						}
						if !reflect.DeepEqual(call["options"], opts) {
							t.Fatal(call)
						}
						id := "stale"
						if m == "listRuns" {
							id = resume
						}
						if call["id"] != id {
							t.Fatal(call)
						}
					}
				}
				if counts["wait"] != 2 || counts["close"] != 1 || counts["send"] != 2+counts["cancelRun"] || (resume != "" && (counts["listRuns"] != 1 || counts["cancelRun"] != 1)) {
					t.Fatal(counts)
				}
			})
		}
	}
}

func TestCursorHelperCancel(t *testing.T) {
	for _, prompt := range []string{"wait", "starting"} {
		t.Run(prompt, func(t *testing.T) {
			s, dir := stubSession(t, "", "")
			started := make(chan struct{})
			done := make(chan error, 1)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			go func() { _, err := s.Prompt(ctx, prompt, &recording{started: started}); done <- err }()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if err := s.Interrupt(ctx); err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if _, err := s.Prompt(ctx, "hello", &recording{}); err != nil {
				t.Fatal(err)
			}
			s.Close()
			count := 0
			for _, call := range sdkCalls(t, dir) {
				if call["method"] == "cancel" {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("cancel called %d times", count)
			}
		})
	}
}

func TestCursorHelperFailure(t *testing.T) {
	for _, tc := range []struct{ resume, prompt, want string }{
		{"", "fail", "SDK quota exhausted"},
		{"", "throw", "send failed"},
		{"", "wait-throw", "wait failed"},
		{"busy-twice", "hello", "already has active run"},
		{"no-active", "hello", "already has active run"},
		{"", "unknown-rejection", "unexpected rejection"},
	} {
		t.Run(tc.resume+tc.prompt, func(t *testing.T) {
			s, _ := stubSession(t, tc.resume, "")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := s.Prompt(ctx, tc.prompt, &recording{}); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatal(err)
			}
		})
	}
}

func TestCursorHelperKnownRejections(t *testing.T) {
	s, _ := stubSession(t, "", "")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, prompt := range []string{"closed-rejection", "connect-rejection", "shell-rejection", "result-only"} {
		r := &recording{}
		if _, err := s.Prompt(ctx, prompt, r); err != nil || strings.Join(r.text, "") != "fallback" {
			t.Fatalf("%s: %+v %v", prompt, r, err)
		}
	}
}

const stubSDK = `
import { appendFileSync } from 'node:fs';
const log = (method, data={}) => appendFileSync('calls', JSON.stringify({method,...data})+'\n');
export class Agent {
 static async create(options) { log('create',{options}); return new Agent('native'); }
 static async resume(id, options) { log('resume',{id,options}); return new Agent(id); }
 static async listRuns(id, options) { log('listRuns',{id,options});return {items:id==='no-active'?[]:[{id:'stale',status:'running'}]}; }
 static async cancelRun(id, options) {log('cancelRun',{id,options});}
 constructor(id){this.agentId=id;this.conflicts=id==='native'?0:id==='busy-twice'?2:1;}
 async send(text, options){
  const {onDelta,...rest}=options;
  log('send',{text,options:rest,onDelta:typeof onDelta==='function'});
  if(this.conflicts-->0) throw new Error('already has active run');
  if(text==='throw') throw new Error('send failed');
  if(text==='fail') return {wait:async()=>{log('wait');return {status:'error',error:{message:'SDK quota exhausted'}};}};
  if(text==='wait-throw') return {wait:async()=>{throw new Error('wait failed');}};
  if(text.endsWith('-rejection')) {
   let error = new Error('unexpected rejection');
   if(text==='closed-rejection') error.name='WriteIterableClosedError';
   if(text==='connect-rejection') {error.name='ConnectError';error.cause=Object.assign(new Error('ended'),{code:'ERR_STREAM_WRITE_AFTER_END'});}
   if(text==='shell-rejection') error={syscall:'spawn zsh',code:'ENOENT',spawnargs:['dump_zsh_state']};
   Promise.reject(error);
  }
  if(text==='wait'||text==='starting') {
   await onDelta({update:{type:'thinking-delta',text:'waiting'}});
   if(text==='starting') await new Promise(r=>setTimeout(r,100));
   let finish;
   const waiting=new Promise(r=>finish=r);
   return {wait:()=>{log('wait');return waiting;},cancel:async()=>{log('cancel');finish({status:'cancelled'});throw Object.assign(new Error('aborted'),{name:'AbortError'});}};
  }
  if(text==='hello') {
   await onDelta({update:{type:'thinking-delta',text:'think'}});
   await onDelta({update:{type:'text-delta',text:'hello'}});
   await onDelta({update:{type:'tool-call-started',callId:'c',toolCall:{type:'read',args:{path:'a.go'}}}});
   await onDelta({update:{type:'turn-ended'}});
   await onDelta({update:{type:'text-delta',text:'again'}});
  }
  return {wait:async()=>{log('wait');await new Promise(r=>setTimeout(r,20));return {status:'finished',result:'fallback'};},cancel:async()=>log('cancel')};
 }
 close(){log('close');}
}
`
