package host

import (
	"strings"
	"testing"
	"time"
)

type blockedInput struct{ entered, release chan struct{} }

func (w blockedInput) Write(b []byte) (int, error) { close(w.entered); <-w.release; return len(b), nil }
func (w blockedInput) Close() error                { return nil }

func TestStderrDoesNotWaitForStdin(t *testing.T) {
	w := blockedInput{make(chan struct{}), make(chan struct{})}
	p := &Process{stdin: w}
	done := make(chan struct{})
	go func() { p.Write([]byte("input")); close(done) }()
	<-w.entered
	tail := make(chan string, 1)
	go func() { p.WriteTail([]byte("diagnostic")); tail <- p.Tail() }()
	select {
	case got := <-tail:
		if got != "diagnostic" {
			t.Fatal(got)
		}
	case <-time.After(time.Second):
		close(w.release)
		t.Fatal("stderr waited for blocked stdin")
	}
	close(w.release)
	<-done
	if e := p.Error().Error(); strings.Contains(e, "<nil>") || !strings.Contains(e, "diagnostic") {
		t.Fatal(e)
	}
}
