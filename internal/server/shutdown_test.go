package server

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestScavengeStopsOnEndStreams(t *testing.T) {
	s := &Server{streamsDone: make(chan struct{})}
	exited := make(chan struct{})
	go func() { defer close(exited); s.scavenge() }()
	s.EndStreams()
	s.EndStreams() // Shutdown callbacks may be repeated.
	select {
	case <-exited:
	case <-time.After(time.Second):
		t.Fatal("scavenger goroutine did not exit after server shutdown")
	}
}

// Stack traces let this test observe the actual watcher loop without adding a
// production API solely for tests. Server tests run sequentially.
func TestEndStreamsStopsGitWatcher(t *testing.T) {
	count := func() int {
		buf := make([]byte, 4<<20)
		n := runtime.Stack(buf, true)
		return strings.Count(string(buf[:n]), "faah/internal/workspace.(*Watcher).loop(")
	}
	before := count()
	s, _ := newTestServer(t)
	t.Cleanup(s.EndStreams)
	deadline := time.Now().Add(2 * time.Second)
	for count() != before+1 {
		if time.Now().After(deadline) {
			t.Fatal("watcher goroutine did not start")
		}
		time.Sleep(time.Millisecond)
	}
	s.EndStreams()
	s.EndStreams()
	deadline = time.Now().Add(2 * time.Second)
	for count() != before {
		if time.Now().After(deadline) {
			t.Fatal("watcher goroutine did not exit after server shutdown")
		}
		time.Sleep(time.Millisecond)
	}
}
