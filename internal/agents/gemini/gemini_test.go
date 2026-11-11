package gemini

import (
	"testing"
)

func TestParseGeminiEvent(t *testing.T) {
	if evs := parse(`{"type":"init","session_id":"s456"}`); len(evs) != 1 || evs[0].Kind != "session" || evs[0].Text != "s456" {
		t.Fatalf("gemini init = %+v", evs)
	}
	toolLine := `{"type":"tool_use","tool_name":"read_file","parameters":{"file_path":"b.go"}}`
	if evs := parse(toolLine); len(evs) != 1 || evs[0].Kind != "tool" || evs[0].Text != "read_file b.go" {
		t.Fatalf("gemini tool = %+v", evs)
	}
	msgLine := `{"type":"message","role":"assistant","content":"thinking...","delta":true}`
	if evs := parse(msgLine); len(evs) != 1 || evs[0].Kind != "text" || evs[0].Text != "thinking..." {
		t.Fatalf("gemini message = %+v", evs)
	}
}
