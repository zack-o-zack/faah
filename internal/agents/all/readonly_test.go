package all

import (
	"errors"
	"testing"

	"faah/internal/agents"
)

func TestCheckPlanUsesNativePolicy(t *testing.T) {
	for _, a := range List() {
		if err := CheckPlan(a.Name(), []string{a.Name()}); err != nil {
			t.Fatal(err)
		}
	}
	if !errors.Is(CheckPlan("custom", []string{"custom"}), agents.ErrNotReadOnly) {
		t.Fatal("custom command allowed Plan mode")
	}
}
