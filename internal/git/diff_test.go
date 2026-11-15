package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git/gittest"
)

func TestDiffPathsUnbornHEAD(t *testing.T) {
	root := t.TempDir()
	gittest.Run(t, root, "init")
	for _, name := range []string{"first.txt", "second.txt", "excluded.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	gittest.Run(t, root, "add", "-A")
	diff := DiffPaths(root, "HEAD", "", "first.txt", "second.txt")
	for _, name := range []string{"first.txt", "second.txt"} {
		if !strings.Contains(diff, "+++ b/"+name+"\n") || !strings.Contains(diff, "+"+name+"\n") {
			t.Errorf("missing staged addition for %s in unborn diff: %q", name, diff)
		}
	}
	if strings.Contains(diff, "excluded.txt") {
		t.Errorf("diff includes a path outside the requested paths: %q", diff)
	}
}
