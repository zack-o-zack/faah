package claude

import (
	"strings"
	"testing"
)

func TestParseClaudeEvent(t *testing.T) {
	evs := parse(`{"type":"assistant","session_id":"s1","message":{"content":[{"type":"text","text":"Looking."},{"type":"tool_use","name":"Edit","input":{"file_path":"a.go"}}]}}`)
	kinds := []string{}
	for _, e := range evs {
		kinds = append(kinds, e.Kind+":"+e.Text)
	}
	want := "session: text:Looking. tool:Edit a.go"
	if got := strings.Join(kinds, " "); got != want {
		t.Fatalf("events = %q, want %q", got, want)
	}
	if evs := parse(`{"type":"result","is_error":true,"result":"bad key"}`); len(evs) != 1 || evs[0].Kind != "error" || evs[0].Text != "bad key" {
		t.Fatalf("error result = %+v", evs)
	}
	if evs := parse("not json"); len(evs) != 0 {
		t.Fatalf("non-JSON yielded %+v", evs)
	}
}

func TestTurnArgv(t *testing.T) {
	tpl := []string{"/bin/claude", "--permission-mode", "acceptEdits", "-p", "{prompt}"}
	first := strings.Join(New().TurnArgv(tpl, "U", false), " ")
	if !strings.Contains(first, "--session-id U") || strings.Contains(first, "--resume") || !strings.Contains(first, "stream-json") {
		t.Fatalf("first turn argv = %s", first)
	}
	next := strings.Join(New().TurnArgv(tpl, "U", true), " ")
	if !strings.Contains(next, "--resume U") || strings.Contains(next, "--session-id") {
		t.Fatalf("resume argv = %s", next)
	}
	if tpl[1] != "--permission-mode" {
		t.Fatal("TurnArgv mutated its template")
	}
}
