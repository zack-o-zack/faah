package all

import (
	"errors"
	"reflect"
	"testing"

	"faah/internal/agents"
	"faah/internal/agents/percmd"
)

func verifyHarnesses(t *testing.T, names ...string) {
	t.Helper()
	prev := agents.Verified
	agents.Verified = map[string]bool{}
	for _, n := range names {
		agents.Verified[n] = true
	}
	t.Cleanup(func() { agents.Verified = prev })
}

func TestReadOnlyArgvRefusesUnverified(t *testing.T) {
	for _, name := range []string{"cursor-agent"} {
		if _, err := readOnly(name, []string{name, "--sandbox", "workspace-write", "--force"}); !errors.Is(err, agents.ErrNotReadOnly) {
			t.Errorf("%s err = %v, want it refused until it passes conformance", name, err)
		}
	}
}

func TestReadOnlyArgv(t *testing.T) {
	verifyHarnesses(t, "claude", "codex", "cursor-agent", "agy", "opencode")
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"claude", []string{"claude", "--permission-mode", "acceptEdits", "-p", "{prompt}"}, []string{"claude", "--permission-mode", "plan", "-p", "{prompt}"}},
		{"cursor-agent", []string{"cursor-agent", "--force", "-p", "{prompt}"}, []string{"cursor-agent", "--mode", "ask", "-p", "{prompt}"}},
	}
	for _, c := range cases {
		got, err := readOnly(c.name, c.in)
		if err != nil || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s = %v, %v; want %v", c.name, got, err, c.want)
		}
	}
	refused := map[string][]string{
		"claude":  {"claude", "-p", "{prompt}"},
		"harness": {"/tmp/harness.sh", "{prompt}"},
	}
	for name, argv := range refused {
		if _, err := readOnly(name, argv); !errors.Is(err, agents.ErrNotReadOnly) {
			t.Errorf("%s err = %v", name, err)
		}
	}
}

// readOnly is the argv half of an agent's read-only rewrite.
func readOnly(name string, argv []string) ([]string, error) {
	if name == "claude" {
		out, ok := agents.SetFlag(argv, "--permission-mode", "plan")
		if !ok {
			return nil, agents.ErrNotReadOnly
		}
		return out, nil
	}
	out, _, err := For(name).(*percmd.Agent).Legacy.ReadOnly(argv)
	return out, err
}

func TestCheckPlanUsesNativePolicy(t *testing.T) {
	for _, name := range []string{"claude", "codex", "agy", "gemini", "opencode"} {
		if err := CheckPlan(name, []string{name, "-p", "{prompt}"}); err != nil {
			t.Fatal(err)
		}
	}
}
