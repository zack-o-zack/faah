package review

import (
	"faah/internal/git"
	"faah/internal/git/gittest"
	"testing"
)

func TestWalkthroughUntracked(t *testing.T) {
	root := gittest.Repo(t)
	response := BuildWalkthrough(WalkthroughOptions{Root: root, DiffBase: "HEAD", Statuses: git.Status(root)})
	for _, f := range response.Files {
		if f.Path == "untr.go" {
			if f.Status != "A" || f.Additions != 1 || f.Deletions != 0 {
				t.Fatalf("untracked: %+v", f)
			}
			return
		}
	}
	t.Fatal("untracked file missing")
}
