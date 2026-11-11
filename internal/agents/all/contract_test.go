package all

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"faah/internal/agents"
)

type sink struct{ text, steps []string }

func (s *sink) Text(t string, _ bool) { s.text = append(s.text, t) }
func (s *sink) Step(t string)         { s.steps = append(s.steps, t) }
func (s *sink) Result(t string)       { s.text = append(s.text, t) }

// fixture is one line of output each harness's parser understands as text.
var fixture = map[string]string{
	"claude": `{"type":"assistant","session_id":"s1","message":{"content":[{"type":"text","text":"hello"}]}}`,
	"agy":    `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hello"}}`,
	"gemini": `{"type":"message","role":"assistant","content":"hello"}`,
}

// Every listed agent runs a fake binary of its own name, for a first turn and
// a follow-up, and reports what it read.
func TestAgentContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake harness is a shell script")
	}
	seen := map[string]bool{}
	for _, a := range List() {
		a := a
		t.Run(a.Name(), func(t *testing.T) {
			if a.Name() == "" || seen[a.Name()] {
				t.Fatalf("name %q is empty or listed twice", a.Name())
			}
			seen[a.Name()] = true
			if For(a.Name()).Name() != a.Name() {
				t.Fatal("For does not find the listed agent")
			}
			dir := t.TempDir()
			line := fixture[a.Name()]
			if line == "" {
				line = "hello"
			}
			bin := filepath.Join(dir, a.Name())
			script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > args.txt\nprintf '%s\\n' '" + line + "'\n"
			if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			argv := []string{bin, "-p", "{prompt}"}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			sid := a.NewSession(ctx, dir, argv)
			for _, resume := range []bool{false, true} {
				s := &sink{}
				_, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", SessionID: sid, Resume: resume, Timeout: 5 * time.Second}, s)
				if err != nil {
					t.Fatalf("resume=%v: %v", resume, err)
				}
				if !strings.Contains(strings.Join(s.text, ""), "hello") {
					t.Fatalf("resume=%v: text = %q", resume, s.text)
				}
				args, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				if !strings.Contains(string(args), "say hello") {
					t.Fatalf("resume=%v: prompt not passed, args = %s", resume, args)
				}
			}
			if strings.Join(argv, " ") != bin+" -p {prompt}" {
				t.Fatalf("Run changed its argv: %q", argv)
			}
			// An agent without sessions runs the argv it is given, prompt filled in.
			if !a.Caps().Sessions {
				args, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				if got := strings.TrimSpace(string(args)); got != "-p\nsay hello" {
					t.Fatalf("args = %q, want the argv unchanged", got)
				}
			}
			// Without a session, an agent that is given its ids runs the argv unchanged.
			if c := a.Caps(); c.Sessions && !c.NamesSession {
				if _, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", Timeout: 5 * time.Second}, &sink{}); err != nil {
					t.Fatal(err)
				}
				args, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				if strings.Contains(string(args), "--session-id") || strings.Contains(string(args), "--resume") {
					t.Fatalf("no session, but args = %s", args)
				}
			}
			if _, _, err := a.ReadOnly(argv); err != nil && !strings.Contains(err.Error(), agents.ErrNotReadOnly.Error()) {
				t.Fatalf("ReadOnly error must wrap ErrNotReadOnly: %v", err)
			}
		})
	}
}
