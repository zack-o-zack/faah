package review

import (
	"faah/internal/git"
	"faah/internal/git/gittest"
	"reflect"
	"testing"
)

func TestWalkthroughBranchBase(t *testing.T) {
	root := gittest.UnpushedRepo(t)
	// Advance the remote-tracking ref on a separate line of history.
	gittest.Run(t, root, "checkout", "-b", "remote-only", "origin/main")
	writeWalkFile(t, root, "remote.txt", "remote only\n")
	gittest.Run(t, root, "add", "-A")
	gittest.Run(t, root, "commit", "-qm", "remote change")
	gittest.Run(t, root, "update-ref", "refs/remotes/origin/main", "HEAD")
	gittest.Run(t, root, "checkout", "main")
	writeWalkFile(t, root, "a.txt", "one\nTWO\nthree\nfour\nworking\n")
	writeWalkFile(t, root, "untracked.txt", "new\n")
	o := WalkthroughOptions{Root: root, DiffBase: "HEAD", Statuses: git.Status(root), ComparisonBase: "origin/main"}
	got := BuildWalkthrough(o)
	if got.BaseRef != "origin/main" || got.HeadRef != "working-tree" {
		t.Fatalf("refs: %+v", got)
	}
	paths := map[string]bool{}
	for _, f := range got.Files {
		paths[f.Path] = true
	}
	if !reflect.DeepEqual(paths, map[string]bool{"a.txt": true, "added.txt": true, "gone.txt": true, "untracked.txt": true}) {
		t.Fatalf("paths: %v", paths)
	}
	if got.TotalAdditions != 5 || got.TotalDeletions != 2 {
		t.Fatalf("counts: %+v", got)
	}
	// Explicit HEAD retains default behavior.
	o.ComparisonBase = ""
	before := BuildWalkthrough(o)
	o.ComparisonBase = "HEAD"
	if !reflect.DeepEqual(before, BuildWalkthrough(o)) {
		t.Fatal("HEAD changed behavior")
	}
}

func TestWalkthroughBranchCleanAndMoves(t *testing.T) {
	root := gittest.Repo(t)
	gittest.Run(t, root, "add", "-A")
	gittest.Run(t, root, "commit", "-qm", "baseline")
	gittest.Run(t, root, "branch", "base")
	o := WalkthroughOptions{Root: root, DiffBase: "HEAD", ComparisonBase: "base"}
	if got := BuildWalkthrough(o); len(got.Files) != 0 || got.HeadRef != "working-tree" {
		t.Fatalf("clean fallback: %+v", got)
	}
	gittest.Run(t, root, "mv", "keep.go", "moved.go")
	writeWalkFile(t, root, "sub/mod.go", "  line two\n")
	o.IgnoreWhitespace = true
	got := BuildWalkthrough(o)
	if len(got.Files) != 1 || got.Files[0].OldPath != "keep.go" || got.HiddenWhitespaceFiles != 1 {
		t.Fatalf("moves and whitespace: %+v", got)
	}
}
