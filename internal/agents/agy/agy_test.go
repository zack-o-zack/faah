package agy

import (
	"testing"
)

func TestParseAgyEvent(t *testing.T) {
	if evs := parse(`{"event":"init","conversation_id":"c123"}`); len(evs) != 1 || evs[0].Kind != "session" || evs[0].Text != "c123" {
		t.Fatalf("agy init = %+v", evs)
	}
	toolLine := `{"event":"step_update","step_update":{"step_type":"tool","tool_name":"view_file","state":"ACTIVE","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/path/file.go"}}}}`
	if evs := parse(toolLine); len(evs) != 1 || evs[0].Kind != "tool" || evs[0].Text != "view_file /path/file.go" {
		t.Fatalf("agy tool = %+v", evs)
	}
	deltaLine := `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hello world"}}`
	if evs := parse(deltaLine); len(evs) != 1 || evs[0].Kind != "text" || evs[0].Text != "hello world" {
		t.Fatalf("agy delta = %+v", evs)
	}
	resLine := `{"event":"result","result":{"status":"SUCCESS","response":"done"}}`
	if evs := parse(resLine); len(evs) != 1 || evs[0].Kind != "result" || evs[0].Text != "done" {
		t.Fatalf("agy result = %+v", evs)
	}
}
