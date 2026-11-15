package git_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"faah/internal/git"
	"faah/internal/git/gittest"
)

// TestPRAheadCountsFromPRHead covers the detached-HEAD case: a PR checkout has
// no upstream, so commits made in the IDE must still count as unpushed
// (measured from the PR head), and stop counting once that head moves.
func TestPRAheadCountsFromPRHead(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	gittest.Run(t, root, "init", "-q", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, root, "config", cfg[0], cfg[1])
	}
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("1\n"), 0o644)
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "pr commit")
	head := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	gittest.Run(t, root, "checkout", "-q", "--detach")

	if n := git.CountSince(root, head); n != 0 {
		t.Fatalf("fresh checkout: ahead = %d, want 0", n)
	}
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("2\n"), 0o644)
	gittest.Run(t, root, "commit", "-qam", "my change")
	if n := git.CountSince(root, head); n != 1 {
		t.Fatalf("after IDE commit: ahead = %d, want 1", n)
	}
	cs := git.CommitsSince(root, head, 0)
	if len(cs) != 1 || cs[0].Subject != "my change" {
		t.Fatalf("unpushed = %+v", cs)
	}
	head = strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	if n := git.CountSince(root, head); n != 0 {
		t.Fatalf("after push moved the head: ahead = %d, want 0", n)
	}
}

// TestGitFilesBetween is the PR's own file set: what changed between the
// merge-base and the PR head, never what the reviewer committed afterwards.
func TestGitFilesBetween(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	gittest.Run(t, root, "init", "-q", "-b", "main")
	for _, cfg := range [][2]string{{"user.email", "t@example.com"}, {"user.name", "T"}, {"commit.gpgsign", "false"}} {
		gittest.Run(t, root, "config", cfg[0], cfg[1])
	}
	write := func(name string) { os.WriteFile(filepath.Join(root, name), []byte(name+"\n"), 0o644) }
	write("base.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "base")
	base := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	write("pr.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "pr")
	head := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))
	write("mine.txt")
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-qm", "mine")

	got := git.FilesBetween(root, base, head)
	if len(got) != 1 || got["pr.txt"] != "A" {
		t.Fatalf("PR files = %v, want map[pr.txt:A]", got)
	}
}
