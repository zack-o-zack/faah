package workspace

import (
	"faah/internal/git"
	"faah/internal/git/gittest"
	"os"
	"path/filepath"
	"testing"
)

func TestGitWatcherCLICommitDetection(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := gittest.Repo(t)
	ix := NewIndex(root)
	ix.Build()

	gw := NewWatcher(ix)
	gitdir := git.Dir(root)
	if !gw.recordGitMeta(gitdir) {
		// First recording initialized the metadata
	}

	// Commit existing changes via CLI
	gittest.Run(t, root, "commit", "-am", "commit all")

	// Watcher's metadata stat check should instantly see the index/HEAD modtime update
	if !gw.recordGitMeta(gitdir) {
		t.Errorf("expected recordGitMeta to report changed=true after CLI commit")
	}
}

func TestGitInitAfterProbeAndWatcherReady(t *testing.T) {
	if !gittest.Installed() {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	if r, err := filepath.EvalSymlinks(root); err == nil {
		root = r
	}
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 1. Probing before git init must return false without permanently caching false.
	if git.Available(root) {
		t.Fatalf("expected gitAvailable(%s) = false before git init", root)
	}

	// Initialize git repository (unborn HEAD, no commits yet).
	gittest.Run(t, root, "init")

	if !git.Available(root) {
		t.Fatalf("expected gitAvailable(%s) = true immediately after git init", root)
	}
	if branch := git.CurrentBranch(root); branch == "" {
		t.Fatalf("expected non-empty branch on unborn HEAD after git init")
	}

	// 2. Simulate workbench startup race: client subscribes before ix.Build() completes.
	ix := NewIndex(root)
	gw := NewWatcher(ix)
	ch, cancel := gw.Subscribe()
	defer cancel()

	// Drain initial pre-index message
	select {
	case <-ch:
	default:
	}

	ix.Build()
	p, changed := gw.refreshInternal(true)
	if !changed {
		t.Fatalf("expected refreshInternal to report changed=true when index transitions to Ready")
	}
	if !p.Git || p.GitChanges != 1 || p.Statuses["hello.txt"] != "U" {
		t.Fatalf("unexpected payload after ix.Build(): %+v", p)
	}

	// 3. Stage and unstage a file on an unborn HEAD (no commits yet).
	if err := git.Stage(root, "hello.txt"); err != nil {
		t.Fatalf("gitStage on unborn HEAD: %v", err)
	}
	if staged := git.StagedPaths(root); !staged["hello.txt"] {
		t.Fatalf("expected hello.txt staged on unborn HEAD, got %v", staged)
	}
	if err := git.Unstage(root, "hello.txt"); err != nil {
		t.Fatalf("gitUnstage on unborn HEAD: %v", err)
	}
	if staged := git.StagedPaths(root); staged["hello.txt"] {
		t.Fatalf("expected hello.txt unstaged on unborn HEAD, got %v", staged)
	}
}
