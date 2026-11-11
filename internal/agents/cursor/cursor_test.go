package cursor

import (
	"strings"
	"testing"
)

func TestTurnArgvResumes(t *testing.T) {
	got := strings.Join(turnArgv([]string{"/bin/cursor-agent", "-p", "{prompt}"}, "C"), " ")
	if !strings.Contains(got, "--resume C") {
		t.Fatalf("cursor argv = %s", got)
	}
}
