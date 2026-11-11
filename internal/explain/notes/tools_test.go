package notes

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type rec struct {
	notes []Note
	walks []Walkthrough
	scope any
}

func (r *rec) AddNotes(scope any, n []Note)            { r.scope, r.notes = scope, append(r.notes, n...) }
func (r *rec) AddWalkthrough(scope any, w Walkthrough) { r.scope, r.walks = scope, append(r.walks, w) }

func TestApplyAnnotate(t *testing.T) {
	r := &rec{}
	args := `{"notes":[{"kind":"line","path":"auth.go","l1":4,"summary":"ok"},{"kind":"line","path":"auth.go","l1":99,"summary":"bad"}]}`
	text, err := Apply(read, r, "turn", "annotate", json.RawMessage(args))
	if err != nil || len(r.notes) != 1 || r.scope != "turn" {
		t.Fatalf("apply = %q %v %+v", text, err, r)
	}
	if !strings.HasPrefix(text, "Shown 1 of 2 notes.") || !strings.Contains(text, "notes[1]: auth.go:99 is past the end") {
		t.Fatalf("text = %q", text)
	}
	if _, err := Apply(read, r, "turn", "annotate", json.RawMessage(`{"notes":[{"kind":"line","path":"auth.go","l1":99,"summary":"bad"}]}`)); err == nil {
		t.Fatal("a call with no valid note must be an error")
	}
	if _, err := Apply(read, r, nil, "annotate", json.RawMessage(args)); err == nil {
		t.Fatal("a call without a turn must be refused")
	}
}

func TestApplyWalkthrough(t *testing.T) {
	r := &rec{}
	args := `{"title":"Login","steps":[{"path":"auth.go","l1":8,"l2":10,"title":"a","body":"b"},{"path":"auth.go","l1":4,"l2":6,"title":"c","body":"d"}]}`
	if text, err := Apply(read, r, "turn", "walkthrough", json.RawMessage(args)); err != nil || text != "Shown a walkthrough of 2 steps." || len(r.walks) != 1 {
		t.Fatalf("walkthrough = %q %v", text, err)
	}
}

func TestToolsServeBoth(t *testing.T) {
	tools := Tools(read, &rec{})
	if len(tools) != 2 || tools[0].Name != "annotate" || tools[1].Name != "walkthrough" || !json.Valid(tools[0].Schema) || !json.Valid(tools[1].Schema) {
		t.Fatalf("tools = %+v", tools)
	}
	if _, err := tools[0].Call(context.Background(), "turn", json.RawMessage(`{"notes":[{"kind":"line","path":"auth.go","l1":4,"summary":"ok"}]}`)); err != nil {
		t.Fatal(err)
	}
}
