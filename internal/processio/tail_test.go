package processio

import "testing"

func TestTailBufferKeepsTheEnd(t *testing.T) {
	b := NewTailBuffer(8)
	b.Write([]byte("0123456789"))
	b.Write([]byte("ab"))
	if got := b.String(); got != "456789ab" {
		t.Errorf("tail = %q, want %q", got, "456789ab")
	}
}
