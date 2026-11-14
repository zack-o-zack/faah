package threads

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestThreadSessionIdleResumes(t *testing.T) {
	root := t.TempDir()
	fakeCLI(t, "claude")
	m := testJobs(root, "claude")
	s := struct{ threads *Manager }{testManager(m, root)}
	t.Cleanup(s.threads.Close)
	s.threads.sessionIdle = 15 * time.Millisecond
	created, _ := s.threads.Create("", "", 0, 0, "hello", "")
	id := created.ID
	waitThreadIdle(t, s.threads, id)
	deadline := time.Now().Add(3 * time.Second)
	for {
		s.threads.mu.Lock()
		live := s.threads.sessions[id] != nil
		s.threads.mu.Unlock()
		if !live {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("session stayed open")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err := s.threads.Send(id, "follow up"); err != nil {
		t.Fatal(err)
	}
	th := waitThreadIdle(t, s.threads, id)
	b, _ := os.ReadFile(filepath.Join(root, "claude-runs.txt"))
	if !strings.Contains(string(b), "--resume "+th.SessionID) || len(strings.Split(strings.TrimSpace(string(b)), "\n")) != 2 {
		t.Fatalf("process args: %s", b)
	}
}
