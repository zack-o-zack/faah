package workspace

import (
	"faah/internal/git"
	"faah/internal/git/gittest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitStatus(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.Repo(t)

	if !git.Available(root) {
		t.Fatal("gitAvailable false for a real repo")
	}
	st := git.Status(root)
	want := map[string]string{
		"sub/mod.go":  "M",
		"add.go":      "A",
		"untr.go":     "U",
		"del.go":      "D",
		"sub/ren2.go": "R",
	}
	for path, code := range want {
		if st[path] != code {
			t.Errorf("status[%q] = %q, want %q (full: %v)", path, st[path], code, st)
		}
	}
	if _, ok := st["keep.go"]; ok {
		t.Errorf("keep.go should have no status, got %q", st["keep.go"])
	}

	// Overlay onto tree nodes. Deleted files appear with status "D".
	ix := NewIndex(root)
	ix.Build()
	byName := map[string]Node{}
	kids, _ := ix.Children("")
	for _, k := range kids {
		byName[k.Name] = k
	}
	sub, _ := ix.Children("sub")
	for _, k := range sub {
		byName[k.Name] = k
	}
	nodeWant := map[string]string{
		"mod.go":  "M",
		"add.go":  "A",
		"untr.go": "U",
		"ren2.go": "R",
		"del.go":  "D",
		"keep.go": "",
	}
	for name, code := range nodeWant {
		if byName[name].Status != code {
			t.Errorf("node %q status = %q, want %q", name, byName[name].Status, code)
		}
	}
	// The sub/ dir holds changed files, so its (collapsed) folder node is dirty.
	if !byName["sub"].Dir || !byName["sub"].Dirty {
		t.Errorf("sub node = %+v, want dir with Dirty=true", byName["sub"])
	}
}

func TestUpdateGitStatus(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.Repo(t)
	ix := NewIndex(root)
	ix.Build()

	count, files, changed, statuses, dirtyDirs, _, _, _ := ix.UpdateGitStatus()
	// Should be unchanged because Build() just ran
	if changed {
		t.Errorf("expected changed=false immediately after Build(), got true")
	}
	if count == 0 || len(files) == 0 {
		t.Errorf("expected non-zero git changes, got count=%d, files=%v", count, files)
	}
	if !dirtyDirs["sub"] {
		t.Errorf("expected 'sub' to be in dirtyDirs, got %v", dirtyDirs)
	}
	if statuses["add.go"] != "A" {
		t.Errorf("expected add.go status 'A', got %q", statuses["add.go"])
	}

	// Now modify another file
	if err := os.WriteFile(filepath.Join(root, "keep.go"), []byte("modified\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	count2, _, changed2, statuses2, _, _, _, _ := ix.UpdateGitStatus()
	if !changed2 {
		t.Errorf("expected changed=true after modifying keep.go")
	}
	if count2 <= count {
		t.Errorf("expected count to increase, got count2=%d vs count=%d", count2, count)
	}
	if statuses2["keep.go"] != "M" {
		t.Errorf("expected keep.go to have status 'M', got %q", statuses2["keep.go"])
	}

	// Calling it again without changes should report changed=false
	_, _, changed3, _, _, _, _, _ := ix.UpdateGitStatus()
	if changed3 {
		t.Errorf("expected changed=false when worktree has not changed")
	}
}

func TestPRReviewerChangesInIndex(t *testing.T) {
	if !git.Available(".") {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	// macOS TempDir lives under /var -> /private/var; git reports the real path.
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	gittest.Run(t, root, "init", "-b", "main")
	gittest.Run(t, root, "config", "user.name", "test")
	gittest.Run(t, root, "config", "user.email", "test@example.com")

	if err := os.MkdirAll(filepath.Join(root, "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pkg", "foo.go"), []byte("package pkg\nfunc A() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-m", "base commit")
	baseSHA := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))

	// PR changes foo.go
	if err := os.WriteFile(filepath.Join(root, "pkg", "foo.go"), []byte("package pkg\nfunc A() {}\nfunc PR() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gittest.Run(t, root, "add", ".")
	gittest.Run(t, root, "commit", "-m", "pr head commit")
	prHeadSHA := strings.TrimSpace(gittest.Run(t, root, "rev-parse", "HEAD"))

	ix := NewIndex(root)
	ix.SetDiffBase(baseSHA)
	ix.SetPRHead(prHeadSHA)
	ix.Build()

	// Initially, working tree matches prHeadSHA:
	// Statuses should report foo.go as M (against diffBase), but yourStatuses must be empty.
	count, files, _, statuses, _, _, yourStatuses, yourDirtyDirs := ix.UpdateGitStatus()
	if count != 1 || len(files) != 1 || statuses["pkg/foo.go"] != "M" {
		t.Fatalf("expected 1 file in PR diff, got statuses=%v", statuses)
	}
	if len(yourStatuses) != 0 || len(yourDirtyDirs) != 0 {
		t.Fatalf("expected empty yourStatuses initially, got %v", yourStatuses)
	}

	// Now reviewer edits foo.go
	if err := os.WriteFile(filepath.Join(root, "pkg", "foo.go"), []byte("package pkg\nfunc A() {}\nfunc PR() {}\nfunc Reviewer() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, _, changed, statuses, _, _, yourStatuses, yourDirtyDirs := ix.UpdateGitStatus()
	if !changed {
		t.Errorf("expected changed=true after reviewer modification")
	}
	if statuses["pkg/foo.go"] != "M" {
		t.Errorf("expected statuses[pkg/foo.go] = M, got %q", statuses["pkg/foo.go"])
	}
	if yourStatuses["pkg/foo.go"] != "M" {
		t.Errorf("expected yourStatuses[pkg/foo.go] = M, got %q", yourStatuses["pkg/foo.go"])
	}
	if !yourDirtyDirs["pkg"] {
		t.Errorf("expected yourDirtyDirs[pkg] = true, got %v", yourDirtyDirs)
	}

	// Check ix.Children() to verify Node fields
	kids, ok := ix.Children("pkg")
	if !ok || len(kids) != 1 {
		t.Fatalf("expected 1 child in pkg, got %v", kids)
	}
	if kids[0].YourStatus != "M" {
		t.Errorf("expected node YourStatus=M, got %q", kids[0].YourStatus)
	}

	// Now reviewer reverts all changes (restore to prHeadSHA)
	gittest.Run(t, root, "checkout", "--", ".")

	_, _, changed2, statuses, _, _, yourStatuses, yourDirtyDirs := ix.UpdateGitStatus()
	if !changed2 {
		t.Errorf("expected changed=true after revert")
	}
	if statuses["pkg/foo.go"] != "M" {
		t.Errorf("expected PR change to remain in statuses, got %v", statuses)
	}
	if len(yourStatuses) != 0 {
		t.Errorf("expected yourStatuses to be empty after revert, got %v", yourStatuses)
	}
	if len(yourDirtyDirs) != 0 {
		t.Errorf("expected yourDirtyDirs to be empty after revert, got %v", yourDirtyDirs)
	}

	kids2, _ := ix.Children("pkg")
	if len(kids2) > 0 && kids2[0].YourStatus != "" {
		t.Errorf("expected node YourStatus to be cleared after revert, got %q", kids2[0].YourStatus)
	}
}
