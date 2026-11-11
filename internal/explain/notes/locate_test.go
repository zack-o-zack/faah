package notes

import "testing"

func TestLocate(t *testing.T) {
	lines := []string{"a", "x", "y", "b", "x", "y"}
	if l1, l2, ok := Locate(lines, "x\ny", 5); !ok || l1 != 5 || l2 != 6 {
		t.Fatalf("nearest = %d-%d %v", l1, l2, ok)
	}
	if l1, _, ok := Locate(lines, "x\ny", 1); !ok || l1 != 2 {
		t.Fatalf("first = %d %v", l1, ok)
	}
	if _, _, ok := Locate(lines, "gone", 1); ok {
		t.Fatal("found missing text")
	}
}
