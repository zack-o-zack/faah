package all

import (
	"strings"
	"testing"
)

func TestCheckPlanUsesNativePolicy(t *testing.T) {
	for _, a := range List() {
		if err := CheckPlan(a.Name()); err != nil {
			t.Fatal(err)
		}
	}
	if For("custom") != nil {
		t.Fatal("unknown agent got an adapter")
	}
	if err := CheckPlan("custom"); err == nil || !strings.Contains(err.Error(), "unknown agent custom; choose one of:") {
		t.Fatalf("unknown agent: %v", err)
	}
}
