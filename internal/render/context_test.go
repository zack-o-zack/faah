package render

import (
	"strings"
	"testing"
)

func TestHighlightRangeInMemory(t *testing.T) {
	d := NewDoc(strings.Repeat("package fixture\n", 2500), "fixture.go")
	lines, err := d.HighlightRange(1000, 2000)
	if err != nil || len(lines) != 1000 {
		t.Fatalf("%d: %v", len(lines), err)
	}
	if !strings.Contains(lines[0], "<i class=k>package</i>") {
		t.Fatal(lines[0])
	}
	d = NewDoc("// "+strings.Repeat("a", hlWindowBytes), "fixture.go")
	if _, err := d.HighlightRange(0, 1); err == nil {
		t.Fatal("oversized window must not silently return plain text")
	}
}
