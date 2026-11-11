package agents

import (
	"encoding/json"
	"testing"
)

func TestToolLabel(t *testing.T) {
	if got := ToolLabel("Edit", json.RawMessage(`{"file_path":"a.go"}`)); got != "Edit a.go" {
		t.Fatalf("got %q", got)
	}
	if got := ToolLabel("Think", nil); got != "Think" {
		t.Fatalf("got %q", got)
	}
}
