//go:build unix

package explain

import (
	"path/filepath"
	"syscall"
	"testing"
)

// A FIFO would block a read forever, so only regular files are read.
func TestReadLinesRefusesFIFO(t *testing.T) {
	p := filepath.Join(t.TempDir(), "pipe")
	if err := syscall.Mkfifo(p, 0o644); err != nil {
		t.Skip(err)
	}
	if _, err := ReadLines(p); err == nil {
		t.Fatal("read a FIFO")
	}
}
