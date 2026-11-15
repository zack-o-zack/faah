package threads

import (
	"fmt"
	"strings"
	"testing"
)

func TestCommitMessagePrompt(t *testing.T) {
	files := []string{"web/src/gitpanel.js", "server.go"}
	stat := " web/src/gitpanel.js | 15 +++\n server.go           | 40 ++-\n 2 files changed, 45 insertions(+), 10 deletions(-)"
	diff := "diff --git a/server.go b/server.go\n--- a/server.go\n+++ b/server.go\n@@ -1 +1 @@\n-old\n+new"
	instruction := "Follow conventional commits format"

	p := CommitMessagePrompt(files, stat, diff, instruction)
	if !strings.Contains(p, "Changed files (2):") {
		t.Errorf("prompt missing changed files header:\n%s", p)
	}
	if !strings.Contains(p, "- web/src/gitpanel.js") || !strings.Contains(p, "- server.go") {
		t.Errorf("prompt missing changed file paths:\n%s", p)
	}
	if !strings.Contains(p, "Summary of changes (diffstat):") || !strings.Contains(p, stat) {
		t.Errorf("prompt missing diffstat summary:\n%s", p)
	}
	if !strings.Contains(p, "Staged diff:") || !strings.Contains(p, diff) {
		t.Errorf("prompt missing staged diff:\n%s", p)
	}
	if !strings.Contains(p, "Additional instructions from the user: "+instruction) {
		t.Errorf("prompt missing user instruction:\n%s", p)
	}

	// Test truncation when there are > 100 files
	manyFiles := make([]string, 125)
	for i := range manyFiles {
		manyFiles[i] = fmt.Sprintf("file%d.go", i)
	}
	p2 := CommitMessagePrompt(manyFiles, "", "", "")
	if !strings.Contains(p2, "Changed files (125):") {
		t.Errorf("prompt missing total count:\n%s", p2)
	}
	if !strings.Contains(p2, "... and 25 more files") {
		t.Errorf("prompt missing truncation notice:\n%s", p2)
	}
	if !strings.Contains(p2, "- file0.go") || !strings.Contains(p2, "- file99.go") {
		t.Errorf("prompt missing head files:\n%s", p2)
	}
	if strings.Contains(p2, "- file100.go") {
		t.Errorf("prompt contains file beyond 100:\n%s", p2)
	}
}
