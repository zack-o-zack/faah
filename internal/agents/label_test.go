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

func TestExplainStepLabels(t *testing.T) {
	for tool, label := range map[string]string{"annotate": "Show notes", "walkthrough": "Show a walkthrough"} {
		for _, call := range []string{tool, "mcp__faah__" + tool, "Run mcp_faah_" + tool} {
			if got := StepLabel(call); got != label {
				t.Fatalf("StepLabel(%q)=%q, want %q", call, got, label)
			}
		}
	}
}
