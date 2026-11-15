package review

import (
	"faah/internal/git/gittest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWalkthroughMoveRetainsModeChange(t *testing.T) {
	root := gittest.Repo(t)
	gittest.Run(t, root, "reset", "--hard", "HEAD")
	gittest.Run(t, root, "clean", "-fd")
	gittest.Run(t, root, "mv", "keep.go", "moved.go")
	if err := os.Chmod(filepath.Join(root, "moved.go"), 0755); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, root, "add", "-A")
	response := BuildWalkthrough(root, "HEAD", "", false, map[string]string{"moved.go": "R"})
	if len(response.Files) != 1 || !strings.Contains(response.Files[0].Diff, "new mode 100755") {
		t.Fatalf("mode change lost: %+v", response)
	}
}
