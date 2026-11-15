package codeintel_test

import (
	"testing"

	"faah/internal/codeintel"
)

func TestLineRef(t *testing.T) {
	if codeintel.LineRef(4, 4) != "4" {
		t.Fatalf("single line ref = %q", codeintel.LineRef(4, 4))
	}
	if codeintel.LineRef(4, 9) != "4-9" {
		t.Fatalf("range ref = %q", codeintel.LineRef(4, 9))
	}
}
