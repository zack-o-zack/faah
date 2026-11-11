package all

import (
	"strings"
	"testing"
)

func TestCheckAskUsesNativePolicy(t *testing.T) {
	for _, a := range List() {
		if err := CheckAsk(a.Name()); err != nil {
			t.Fatal(err)
		}
	}
	if For("custom") != nil {
		t.Fatal("unknown agent got an adapter")
	}
	if err := CheckAsk("custom"); err == nil || !strings.Contains(err.Error(), "unknown agent custom; choose one of:") {
		t.Fatalf("unknown agent: %v", err)
	}
}
