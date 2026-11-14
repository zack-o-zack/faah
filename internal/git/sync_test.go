package git

import (
	"os"
	"path/filepath"
	"testing"

	"faah/internal/git/gittest"
)

func TestGitAheadBehind(t *testing.T) {
	// Create bare remote repository
	remoteDir := t.TempDir()
	gittest.Run(t, remoteDir, "init", "--bare")

	// Create local repository
	localDir := t.TempDir()
	gittest.Run(t, localDir, "init")
	gittest.Run(t, localDir, "config", "user.email", "alice@example.com")
	gittest.Run(t, localDir, "config", "user.name", "Alice")
	gittest.Run(t, localDir, "checkout", "-b", "main")

	// Commit 1
	os.WriteFile(filepath.Join(localDir, "a.txt"), []byte("hello"), 0o644)
	gittest.Run(t, localDir, "add", "a.txt")
	gittest.Run(t, localDir, "commit", "-m", "init")

	// Add remote and push with upstream
	gittest.Run(t, localDir, "remote", "add", "origin", remoteDir)
	gittest.Run(t, localDir, "push", "-u", "origin", "main")

	// Initially in sync: ahead=0, behind=0
	ahead, behind, hasUpstream := AheadBehind(localDir)
	if !hasUpstream {
		t.Fatalf("expected hasUpstream=true")
	}
	if ahead != 0 || behind != 0 {
		t.Fatalf("expected ahead=0 behind=0, got ahead=%d behind=%d", ahead, behind)
	}

	// Make a new commit locally
	os.WriteFile(filepath.Join(localDir, "a.txt"), []byte("hello 2"), 0o644)
	gittest.Run(t, localDir, "add", "a.txt")
	gittest.Run(t, localDir, "commit", "-m", "update 1")

	// Now ahead=1, behind=0
	ahead, behind, _ = AheadBehind(localDir)
	if ahead != 1 || behind != 0 {
		t.Fatalf("expected ahead=1 behind=0, got ahead=%d behind=%d", ahead, behind)
	}

	// Push changes
	gittest.Run(t, localDir, "push")

	// Back in sync: ahead=0
	ahead, behind, _ = AheadBehind(localDir)
	if ahead != 0 || behind != 0 {
		t.Fatalf("expected ahead=0 behind=0 after push, got ahead=%d behind=%d", ahead, behind)
	}
}
