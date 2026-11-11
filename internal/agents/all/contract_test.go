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

// fixture is the output each harness's fake prints: for a stream-json
// harness, a session, a tool step and some text. Anything else prints text.
var fixture = map[string][]string{
	"claude": {`{"type":"assistant","session_id":"s1","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.go"}},{"type":"text","text":"hello"}]}}`},
	"agy": {
		`{"event":"init","conversation_id":"c123"}`,
		`{"event":"step_update","step_update":{"step_type":"tool","tool_name":"view_file","state":"ACTIVE"}}`,
		`{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hello"}}`,
	},
	"gemini": {
		`{"type":"init","session_id":"g1"}`,
		`{"type":"tool_use","tool_name":"read_file","parameters":{"file_path":"a.go"}}`,
		`{"type":"message","role":"assistant","content":"hello"}`,
	},
}

// expect is what each listed agent must do. {sid} is the id NewSession
// returned. A follow-up resumes that id, or the id the harness reported when
// it was given none.
type expect struct {
	caps          agents.Caps
	first, resume string // the args the fake receives, joined by spaces
	live          bool   // the session can be resumed after the first turn
	steps         bool   // the output's tool step reaches the sink
}

var contract = map[string]expect{
	"claude": {caps: agents.Caps{Sessions: true}, live: true, steps: true,
		first:  "--output-format stream-json --verbose --session-id {sid} -p say hello",
		resume: "--output-format stream-json --verbose --resume {sid} -p say hello"},
	"agy": {caps: agents.Caps{Sessions: true, NamesSession: true}, live: true, steps: true,
		first:  "--output-format stream-json -p say hello",
		resume: "--output-format stream-json --conversation c123 -p say hello"},
	"gemini": {caps: agents.Caps{Sessions: true}, live: true, steps: true,
		first:  "--output-format stream-json --session-id {sid} -p say hello",
		resume: "--output-format stream-json --resume {sid} -p say hello"},
	"cursor-agent": {caps: agents.Caps{Sessions: true}, live: true,
		first:  "--resume {sid} -p say hello",
		resume: "--resume {sid} -p say hello"},
	"codex":    {first: "-p say hello", resume: "-p say hello"},
	"opencode": {first: "-p say hello", resume: "-p say hello"},
}

// Every listed agent runs a fake binary of its own name, for a first turn and
// a follow-up, and must match its row in contract.
func TestAgentContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake harness is a shell script")
	}
	seen := map[string]bool{}
	for _, a := range List() {
		a := a
		t.Run(a.Name(), func(t *testing.T) {
			want, ok := contract[a.Name()]
			if !ok {
				t.Fatalf("add %s to the contract table", a.Name())
			}
			if seen[a.Name()] {
				t.Fatalf("%s is listed twice", a.Name())
			}
			seen[a.Name()] = true
			if For(a.Name()).Name() != a.Name() {
				t.Fatal("For does not find the listed agent")
			}
			if a.Caps() != want.caps {
				t.Fatalf("caps = %+v, want %+v", a.Caps(), want.caps)
			}
			dir := t.TempDir()
			lines := fixture[a.Name()]
			if lines == nil {
				lines = []string{"hello"}
			}
			bin := filepath.Join(dir, a.Name())
			script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > args.txt\nprintf '%s\\n' '" + strings.Join(lines, "' '") + "'\n"
			if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
				t.Fatal(err)
			}
			argv := []string{bin, "-p", "{prompt}"}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			args := func() string {
				b, _ := os.ReadFile(filepath.Join(dir, "args.txt"))
				return strings.Join(strings.Fields(string(b)), " ")
			}

			sid := a.NewSession(ctx, dir, argv)
			if want.caps.Sessions && !want.caps.NamesSession && sid == "" {
				t.Fatal("NewSession gave no id")
			}
			s := &sink{}
			out, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", SessionID: sid, Timeout: 5 * time.Second}, s)
			if err != nil {
				t.Fatal(err)
			}
			if got, w := args(), strings.ReplaceAll(want.first, "{sid}", sid); got != w {
				t.Fatalf("first turn args = %q, want %q", got, w)
			}
			if !strings.Contains(strings.Join(s.text, ""), "hello") {
				t.Fatalf("text = %q", s.text)
			}
			if out.Live != want.live {
				t.Fatalf("live = %v, want %v", out.Live, want.live)
			}
			if want.steps != (len(s.steps) > 0) {
				t.Fatalf("steps = %q, want some: %v", s.steps, want.steps)
			}

			next := sid // as runTurn does: a reported id is used only when none was given
			if next == "" {
				next = out.SessionID
			}
			if _, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", SessionID: next, Resume: out.Live, Timeout: 5 * time.Second}, &sink{}); err != nil {
				t.Fatal(err)
			}
			if got, w := args(), strings.ReplaceAll(want.resume, "{sid}", sid); got != w {
				t.Fatalf("follow-up args = %q, want %q", got, w)
			}
			if strings.Join(argv, " ") != bin+" -p {prompt}" {
				t.Fatalf("Run changed its argv: %q", argv)
			}

			// Without a session, an agent that is given its ids runs the argv unchanged.
			if c := a.Caps(); c.Sessions && !c.NamesSession {
				if _, err := a.Run(ctx, agents.Turn{Dir: dir, Argv: argv, Prompt: "say hello", Timeout: 5 * time.Second}, &sink{}); err != nil {
					t.Fatal(err)
				}
				if got := args(); got != "-p say hello" {
					t.Fatalf("no session, but args = %q", got)
				}
			}
			if _, _, err := a.ReadOnly(argv); err != nil && !strings.Contains(err.Error(), agents.ErrNotReadOnly.Error()) {
				t.Fatalf("ReadOnly error must wrap ErrNotReadOnly: %v", err)
			}
		})
	}
}
